// Content-addressed video evidence. Does not read credentials or send messages.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

export const PROMPT_VERSION = 'video-evidence-1'
const MAX_JSON = 8 * 1024 * 1024
export const stable = x => JSON.stringify(canonical(x))
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical)
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])]))
  if (typeof x === 'number' && !Number.isFinite(x)) throw new Error('数值必须有限')
  return x
}
export const digest = x => crypto.createHash('sha256').update(typeof x === 'string' ? x : stable(x)).digest('hex')
const validKey = key => { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('缓存键无效'); return key }
const finite = value => typeof value === 'number' && Number.isFinite(value)
export function selectSubtitle(tracks, preferred) {
  const rows = Array.isArray(tracks) ? tracks.filter(s => s && typeof s.lan === 'string') : []
  if (preferred) {
    const exact = rows.find(s => s.lan === preferred)
    if (!exact) throw new Error('指定字幕语言不可用')
    return exact
  }
  return rows.find(s => s.lan === 'zh-CN') ?? rows.find(s => /^zh(?:-|$)/i.test(s.lan))
    ?? rows.find(s => s.lan === 'ai-zh') ?? rows[0] ?? null
}

export function buildMaterial({ bvid, cid, track = null, body = [], duration, fetchedAt = new Date().toISOString(), options = {}, promptVersion = PROMPT_VERSION }) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d+$/.test(String(cid))) throw new Error('BV/CID无效')
  if (!finite(duration) || duration <= 0 || !Number.isFinite(Date.parse(fetchedAt))) throw new Error('时长或获取时间无效')
  if (!Array.isArray(body) || body.length > 100000) throw new Error('字幕格式或长度无效')
  const rows = body.map(row => {
    if (!finite(row.from) || !finite(row.to) || row.from < 0 || row.to < row.from || row.to > duration + 5 || typeof row.content !== 'string') throw new Error('字幕时间范围或文本无效')
    return { from: row.from, to: row.to, content: row.content }
  }).sort((a, b) => a.from - b.from)
  const trackInfo = track ? { language: String(track.lan), kind: track.lan === 'local-asr' ? 'local-asr' : String(track.lan).startsWith('ai-') ? 'automatic' : 'manual', id: String(track.id_str ?? track.id ?? '') } : null
  const contentHash = digest(rows)
  const identity = { bvid, cid: String(cid), track: trackInfo, contentHash, duration, options, promptVersion }
  const key = digest(identity)
  const material = { schema: 1, key, ...identity, fetchedAt, sourceUrl: `https://www.bilibili.com/video/${bvid}/`,
    duration, range: rows.length ? { from: rows[0].from, to: rows.reduce((end, row) => Math.max(end, row.to), 0) } : null,
    limitations: rows.length ? ['字幕只证明所覆盖的台词，不能证明画面、语气或全部视频事实。'] : ['未取得字幕，不能据标题、评论或弹幕声称已完整理解视频。'], rows }
  if (Buffer.byteLength(stable(material)) > MAX_JSON) throw new Error('字幕材料超过8MiB上限')
  return { ...material, integrity: digest(material) }
}

function write(root, kind, key, value) {
  validKey(key)
  const dir = path.join(root, kind); fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, key + '.json'), temp = file + '.' + crypto.randomUUID() + '.tmp'
  const raw = stable(value)
  if (Buffer.byteLength(raw) > MAX_JSON) throw new Error('缓存超过8MiB上限')
  try { fs.writeFileSync(temp, raw, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  return file
}
function read(root, kind, key) {
  const file = path.join(root, kind, validKey(key) + '.json')
  try {
    if (fs.statSync(file).size > MAX_JSON) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch { return null }
}
export function storeMaterial(root, material) {
  const { integrity, ...payload } = material
  const { bvid, cid, track, contentHash, duration, options, promptVersion } = material
  if (material.schema !== 1 || digest(payload) !== integrity || digest(material.rows) !== contentHash || digest({ bvid, cid, track, contentHash, duration, options, promptVersion }) !== material.key) throw new Error('材料哈希不匹配')
  return write(root, 'materials', material.key, material)
}
export function loadMaterial(root, key, { now = Date.now(), maxAgeMs = 86400000 } = {}) {
  try {
  if (!finite(now) || !finite(maxAgeMs) || maxAgeMs < 0) return null
  const m = read(root, 'materials', key)
  if (!m || m.key !== key || now < Date.parse(m.fetchedAt) || now - Date.parse(m.fetchedAt) > maxAgeMs || !Number.isFinite(Date.parse(m.fetchedAt))) return null
  const { integrity, ...payload } = m
  const { bvid, cid, track, contentHash, duration, options, promptVersion } = m
  if (m.schema !== 1 || digest(payload) !== integrity || digest(m.rows) !== contentHash || digest({ bvid, cid, track, contentHash, duration, options, promptVersion }) !== key) return null
  return m
  } catch { return null }
}
export function resultKey(materialKey, { personaRevision, sessionScope, modelVersion, promptVersion = PROMPT_VERSION }) {
  validKey(materialKey)
  if (![personaRevision, sessionScope, modelVersion, promptVersion].every(x => typeof x === 'string' && x.trim())) throw new Error('结果缓存需要人格版本、会话范围与模型版本')
  return digest({ materialKey, personaRevision: digest(personaRevision), sessionScope: digest(sessionScope), modelVersion, promptVersion })
}
export function storeResult(root, materialKey, scope, text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('结果不能为空')
  const key = resultKey(materialKey, scope)
  write(root, 'results', key, { schema: 1, key, materialKey, text, textHash: digest(text), createdAt: new Date().toISOString() })
  return key
}
export function loadResult(root, materialKey, scope, options) {
  if (!loadMaterial(root, materialKey, options)) return null
  const key = resultKey(materialKey, scope), r = read(root, 'results', key)
  return r?.key === key && r.materialKey === materialKey && typeof r.text === 'string' && digest(r.text) === r.textHash ? r : null
}

// Delivery is a separate durable ledger: caching never implies a successful send.
// 'sending' is recorded before invoking transport, so a crash cannot auto-retry.
export async function deliverOnce(root, resultId, destinationScope, transport) {
  validKey(resultId)
  if (typeof destinationScope !== 'string' || !destinationScope.trim()) throw new Error('投递范围不能为空')
  const id = digest({ resultId, destinationScope: digest(destinationScope) })
  const dir = path.join(root, 'delivery'); fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, id + '.json')
  try { fs.writeFileSync(file, stable({ state: 'sending', at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }) }
  catch (e) { if (e.code === 'EEXIST') return { state: 'blocked', reason: '已有投递记录；包括未知结果都须人工核对，不自动重发' }; throw e }
  let state = 'uncertain'
  try { if ((await transport())?.confirmed === true) state = 'delivered' } catch { /* no automatic retry */ }
  write(root, 'delivery', id, { state, at: new Date().toISOString() })
  return { state }
}

// A local adapter speaks JSON {body:[{from,to,content}]} on stdout. No adapter,
// model download, audio acquisition, or network fallback is configured here.
function wavDuration(audioPath) {
  const raw = fs.readFileSync(audioPath)
  if (raw.toString('ascii', 0, 4) !== 'RIFF' || raw.toString('ascii', 8, 12) !== 'WAVE') throw new Error('ASR只接受已提取的PCM WAV音频')
  let rate = 0, data = 0
  for (let at = 12; at + 8 <= raw.length;) {
    const size = raw.readUInt32LE(at + 4), name = raw.toString('ascii', at, at + 4)
    if (at + 8 + size > raw.length) throw new Error('WAV音频不完整')
    if (name === 'fmt ') {
      if (size < 16 || raw.readUInt16LE(at + 8) !== 1) throw new Error('ASR需要PCM WAV音频')
      rate = raw.readUInt32LE(at + 16)
      const channels = raw.readUInt16LE(at + 10), sampleRate = raw.readUInt32LE(at + 12), bits = raw.readUInt16LE(at + 22)
      if (!channels || !sampleRate || ![8,16,24,32].includes(bits) || rate !== channels * sampleRate * bits / 8) throw new Error('WAV采样信息不一致')
    }
    if (name === 'data') data += size
    at += 8 + size + (size % 2)
  }
  if (!rate || !data) throw new Error('WAV音频为空或格式无效')
  return data / rate
}
export async function boundedAsr({ enabled = false, audioPath, duration, executable, args = [], timeoutMs = 60000, maxBytes = 20 * 1024 * 1024, maxSeconds = 300 }) {
  if (!enabled) return { available: false, reason: 'ASR未启用' }
  if (![maxBytes, maxSeconds].every(x => finite(x) && x > 0)) throw new Error('ASR限制无效')
  if (!finite(duration) || duration <= 0 || duration > Math.min(maxSeconds, 300)) throw new Error('ASR音频时长超过限制')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('ASR超时上限为60秒')
  if (!path.isAbsolute(audioPath ?? '') || !path.isAbsolute(executable ?? '') || !fs.statSync(audioPath).isFile() || !fs.statSync(executable).isFile()) throw new Error('ASR需要已有本地音频和已安装适配器')
  if (fs.statSync(audioPath).size > Math.min(maxBytes, 20 * 1024 * 1024)) throw new Error('ASR音频超过大小限制')
  const actualDuration = wavDuration(audioPath)
  if (actualDuration > Math.min(maxSeconds, 300) || Math.abs(actualDuration - duration) > 1) throw new Error('ASR实际音频时长不符或超过限制')
  if (!Array.isArray(args) || !args.every(x => typeof x === 'string')) throw new Error('ASR参数无效')
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args, audioPath], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs })
    let buffers = [], bytes = 0, settled = false
    const fail = message => { if (!settled) { settled = true; child.kill(); reject(new Error(message)) } }
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_JSON) fail('ASR输出超过限制'); else buffers.push(chunk) })
    child.on('error', () => fail('ASR适配器启动失败'))
    child.on('close', code => {
      if (settled) return
      settled = true
      if (code !== 0) return reject(new Error('ASR未完成或已超时'))
      try {
        const result = JSON.parse(Buffer.concat(buffers).toString('utf8'))
        if (!Array.isArray(result.body) || result.body.length > 100000 || result.body.some(row =>
          !row || !finite(row.from) || !finite(row.to) || row.from < 0 || row.to < row.from || row.to > actualDuration + 1 || typeof row.content !== 'string')) throw new Error()
        resolve({ available: true, body: result.body, source: 'local-asr', limitation: '自动转写可能有误，需核对音频；没有执行视频下载。' })
      } catch { reject(new Error('ASR适配器输出格式无效')) }
    })
  })
}
