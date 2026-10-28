// Explicit local PCM WAV to existing adapter. No acquisition or model download.
import fs from 'node:fs'
import { dshPath } from '../lib/paths.mjs'
import { boundedAsr, buildMaterial, storeMaterial } from '../lib/video-evidence.mjs'
const [flag, requestFile] = process.argv.slice(2)
try {
  if (flag !== '--enable' || !requestFile || fs.statSync(requestFile).size > 65536) throw new Error('用法: video-asr --enable <本地请求.json>；默认关闭，需要已有PCM WAV与本地适配器')
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'))
  const result = await boundedAsr({ ...request, enabled: true })
  const material = buildMaterial({ bvid: request.bvid, cid: request.cid, duration: request.duration, track: { lan: 'local-asr' }, body: result.body, options: { source: 'local-audio', adapterVersion: request.adapterVersion ?? 'unspecified' } })
  console.log(JSON.stringify({ materialFile: storeMaterial(dshPath('video-evidence'), material), key: material.key, limitation: result.limitation }))
} catch (error) { console.error(error.message); process.exitCode = 2 }
