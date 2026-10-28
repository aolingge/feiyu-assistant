// Local-only result cache; never sends a message or calls a model.
import fs from 'node:fs'
import { dshPath } from '../lib/paths.mjs'
import { loadMaterial, loadResult, storeResult } from '../lib/video-evidence.mjs'
const [action, materialKey, scopeFile, textFile] = process.argv.slice(2)
try {
  const root = dshPath('video-evidence')
  if (!['show','record'].includes(action) || !materialKey || !scopeFile) throw new Error('用法: video-cache show|record <材料key> <scope.json> [正文.txt]')
  if (fs.statSync(scopeFile).size > 65536) throw new Error('scope文件过大')
  const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'))
  if (!loadMaterial(root, materialKey)) throw new Error('字幕材料缺失、损坏或超过24小时；请先重新获取依据')
  if (action === 'show') {
    const cached = loadResult(root, materialKey, scope)
    console.log(JSON.stringify(cached ? { found: true, ...cached } : { found: false, reason: '该人格/会话/模型版本没有匹配结果' }))
  } else {
    if (!textFile || fs.statSync(textFile).size > 1024 * 1024) throw new Error('需要1MiB以内正文文件')
    const key = storeResult(root, materialKey, scope, fs.readFileSync(textFile, 'utf8'))
    console.log(JSON.stringify({ key, stored: true, delivered: false }))
  }
} catch (error) { console.error(error.message); process.exitCode = 2 }
