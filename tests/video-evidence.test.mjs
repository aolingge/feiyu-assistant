import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { selectSubtitle, buildMaterial, storeMaterial, loadMaterial, resultKey, storeResult, loadResult, deliverOnce, boundedAsr } from '../tools/lib/video-evidence.mjs'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-video-evidence-'))
after(() => fs.rmSync(root, { recursive: true, force: true }))
const input = { bvid: 'BV1234567890', cid: 42, duration: 10, track: { lan: 'zh-CN', id: 12, subtitle_url: 'https://invalid/?auth_key=not-persisted' }, body: [{ from: 1, to: 4, content: 'synthetic words' }], options: { grid: '3x3' } }
const scope = { personaRevision: 'persona-v1', sessionScope: 'group-1', modelVersion: 'model-v1' }
test('manual Chinese wins over AI; explicit selection remains supported', () => {
  const ai = { lan: 'ai-zh' }, manual = { lan: 'zh-CN' }
  assert.equal(selectSubtitle([ai, manual]), manual)
  assert.equal(selectSubtitle([ai, { lan: 'zh-Hant' }]).lan, 'zh-Hant')
  assert.equal(selectSubtitle([ai, manual], 'ai-zh'), ai)
  assert.throws(() => selectSubtitle([ai], 'en'))
  assert.equal(selectSubtitle([]), null)
})
test('provenance includes real range and omits expiring authorization URL', () => {
  const m = buildMaterial(input)
  assert.deepEqual(m.range, { from: 1, to: 4 })
  assert.equal(m.track.kind, 'manual'); assert.equal(m.cid, '42')
  assert.doesNotMatch(JSON.stringify(m), /auth_key|not-persisted/)
  assert.match(m.limitations[0], /不能证明/)
  assert.match(buildMaterial({ ...input, track: null, body: [] }).limitations[0], /未取得字幕/)
})
test('material changes invalidate key; retrieval time alone does not', () => {
  const m = buildMaterial(input)
  for (const change of [{ cid: 43 }, { duration: 11 }, { body: [{ from: 1, to: 4, content: 'changed' }] }, { options: { grid: '4x4' } }, { promptVersion: 'v2' }, { track: { lan: 'ai-zh' } }]) assert.notEqual(buildMaterial({ ...input, ...change }).key, m.key)
  assert.equal(buildMaterial({ ...input, fetchedAt: '2026-01-01T00:00:00Z' }).key, m.key)
})
test('material TTL, future timestamp and corruption all fail closed', () => {
  const m = buildMaterial(input), file = storeMaterial(root, m)
  assert.ok(loadMaterial(root, m.key))
  assert.equal(loadMaterial(root, m.key, { now: Date.parse(m.fetchedAt) + 86400001 }), null)
  assert.equal(loadMaterial(root, m.key, { now: Date.parse(m.fetchedAt) - 1 }), null)
  fs.writeFileSync(file, JSON.stringify({ ...m, rows: [{ content: 'tampered' }] }))
  assert.equal(loadMaterial(root, m.key), null)
  fs.writeFileSync(file, '{broken'); assert.equal(loadMaterial(root, m.key), null)
  fs.writeFileSync(file, '{}'); assert.equal(loadMaterial(root, m.key), null)
  for (const metadata of [{ range: { from: 0, to: 10 } }, { fetchedAt: new Date(Date.parse(m.fetchedAt) + 1).toISOString() }, { sourceUrl: 'https://invalid/' }, { schema: 2 }]) {
    fs.writeFileSync(file, JSON.stringify({ ...m, ...metadata }))
    assert.equal(loadMaterial(root, m.key), null)
  }
  assert.equal(loadMaterial(root, m.key, { now: NaN }), null)
  assert.equal(loadMaterial(root, m.key, { maxAgeMs: NaN }), null)
  storeMaterial(root, m)
})
test('result isolation covers persona, session and model versions', () => {
  const m = buildMaterial(input); storeMaterial(root, m)
  const key = storeResult(root, m.key, scope, 'synthetic summary')
  assert.equal(loadResult(root, m.key, scope).text, 'synthetic summary')
  for (const delta of [{ personaRevision: 'v2' }, { sessionScope: 'group-2' }, { modelVersion: 'model-v2' }, { promptVersion: 'v2' }]) {
    assert.notEqual(resultKey(m.key, { ...scope, ...delta }), key)
    assert.equal(loadResult(root, m.key, { ...scope, ...delta }), null)
  }
  assert.throws(() => resultKey(m.key, { ...scope, sessionScope: '' }))
})
test('concurrent and uncertain delivery never auto-resends', async () => {
  let calls = 0
  const key = resultKey(buildMaterial(input).key, scope)
  const results = await Promise.all(Array.from({ length: 8 }, () => deliverOnce(root, key, 'synthetic-destination', async () => { calls++; throw new Error('unknown send outcome') })))
  assert.equal(calls, 1)
  assert.equal(results.filter(r => r.state === 'uncertain').length, 1)
  assert.equal(results.filter(r => r.state === 'blocked').length, 7)
  assert.equal((await deliverOnce(root, key, 'synthetic-destination', () => { calls++; return { confirmed: true } })).state, 'blocked')
  assert.equal(calls, 1)
})
test('confirmed delivery is recorded separately from cached result', async () => {
  const key = resultKey(buildMaterial(input).key, scope)
  assert.equal((await deliverOnce(root, key, 'another-destination', async () => ({ confirmed: true }))).state, 'delivered')
  assert.ok(fs.existsSync(path.join(root, 'results', key + '.json')))
  assert.equal((await deliverOnce(root, key, 'another-destination', () => { throw new Error('must not call') })).state, 'blocked')
})
function wav(seconds) {
  const data = Buffer.alloc(16000 * 2 * seconds), header = Buffer.alloc(44)
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  const audio = path.join(root, `audio-${seconds}.wav`); fs.writeFileSync(audio, Buffer.concat([header, data])); return audio
}
test('ASR is off by default; local synthetic adapter succeeds within bounds', async () => {
  assert.equal((await boundedAsr({})).available, false)
  const result = await boundedAsr({ enabled: true, audioPath: wav(1), duration: 1, executable: process.execPath, args: ['-e', 'console.log(JSON.stringify({body:[{from:0,to:1,content:"synthetic"}]}))'] })
  assert.equal(result.available, true); assert.equal(result.body[0].content, 'synthetic')
})
test('ASR rejects excessive audio, false duration, malformed output and timeout', async () => {
  const options = { enabled: true, audioPath: wav(1), duration: 1, executable: process.execPath, args: ['-e', 'console.log("bad")'] }
  await assert.rejects(boundedAsr({ ...options, duration: 301 }), /时长/)
  await assert.rejects(boundedAsr({ ...options, duration: 10 }), /时长/)
  await assert.rejects(boundedAsr({ ...options, maxBytes: 100 }), /大小/)
  await assert.rejects(boundedAsr(options), /格式/)
  await assert.rejects(boundedAsr({ ...options, args: ['-e', 'console.log(JSON.stringify({body:[{from:0,to:99,content:"bad range"}]}))'] }), /格式/)
  await assert.rejects(boundedAsr({ ...options, args: ['-e', 'console.log(JSON.stringify({body:[{from:0,to:1,content:42}]}))'] }), /格式/)
  await assert.rejects(boundedAsr({ ...options, timeoutMs: 20, args: ['-e', 'setTimeout(()=>{},5000)'] }), /超时/)
})
test('invalid subtitle times, oversized payloads and path keys rejected', () => {
  assert.throws(() => buildMaterial({ ...input, body: [{ from: 4, to: 1, content: 'bad' }] }))
  assert.throws(() => buildMaterial({ ...input, body: [{ from: 1, to: 2, content: 'x'.repeat(9 * 1024 * 1024) }] }))
  assert.throws(() => resultKey('../escape', scope))
})
test('local result CLI records and reads without model/network/delivery', () => {
  const m = buildMaterial(input), data = path.join(root, 'cli-data'); storeMaterial(path.join(data, 'video-evidence'), m)
  const scopeFile = path.join(root, 'scope.json'), textFile = path.join(root, 'summary.txt')
  fs.writeFileSync(scopeFile, JSON.stringify(scope)); fs.writeFileSync(textFile, 'synthetic CLI summary')
  const command = new URL('../tools/commands/video-cache.mjs', import.meta.url)
  const script = fileURLToPath(command)
  const record = spawnSync(process.execPath, [script, 'record', m.key, scopeFile, textFile], { env: { ...process.env, DSH_HOME: data }, encoding: 'utf8' })
  assert.equal(record.status, 0, record.stderr); assert.equal(JSON.parse(record.stdout).delivered, false)
  const show = spawnSync(process.execPath, [script, 'show', m.key, scopeFile], { env: { ...process.env, DSH_HOME: data }, encoding: 'utf8' })
  assert.equal(show.status, 0, show.stderr); assert.equal(JSON.parse(show.stdout).text, 'synthetic CLI summary')
})
test('all three video CLIs prefer manual Chinese and persist honest absence evidence', () => {
  const helper = new URL('./helpers/video-evidence-fetch.mjs', import.meta.url).href
  for (const command of ['subtitles', 'video-content', 'debrief']) for (const absent of [false, true]) {
    const home = path.join(root, `${command}-${absent}`), data = path.join(home, '.dsh')
    fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
    fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), '{}')
    const script = fileURLToPath(new URL(`../tools/commands/${command}.mjs`, import.meta.url))
    const run = spawnSync(process.execPath, ['--import', helper, script, input.bvid, ...(command === 'debrief' ? ['--no-frames'] : [])], {
      env: { ...process.env, USERPROFILE: home, HOME: home, DSH_HOME: data, BILI_WHALE_CONFIG: path.join(data, 'config.json'), BILI_TRAFFIC_TEST: '1', BILI_NO_CACHE: '1', TEST_NO_SUBTITLE: absent ? '1' : '' }, encoding: 'utf8', timeout: 20000,
    })
    assert.equal(run.status, 0, `${command}: ${run.stderr}`)
    const materials = path.join(data, 'video-evidence', 'materials'), files = fs.readdirSync(materials)
    assert.equal(files.length, 1)
    const raw = fs.readFileSync(path.join(materials, files[0]), 'utf8'), m = JSON.parse(raw)
    assert.ok(loadMaterial(path.join(data, 'video-evidence'), m.key))
    assert.doesNotMatch(raw, /auth_key|synthetic-only/)
    if (absent) { assert.equal(m.rows.length, 0); assert.match(m.limitations[0], /未取得字幕/) }
    else { assert.equal(m.track.language, 'zh-CN'); assert.equal(m.rows[0].content, 'Synthetic manual Chinese') }
  }
})
