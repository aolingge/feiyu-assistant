import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS } from '../tools/lib/config.mjs'
import { readNightConfig } from '../tools/lib/night-config.mjs'

test('account access and scheduled actions require opt-in', () => {
  assert.equal(DEFAULTS.listen.comment, false)
  assert.equal(DEFAULTS.listen.dm, false)
  assert.equal(DEFAULTS.listen.live, false)
  assert.equal(DEFAULTS.share.enabled, false)
  assert.deepEqual(DEFAULTS.night.windows, [])
  assert.deepEqual(DEFAULTS.preferences.like, [])
  assert.deepEqual(DEFAULTS.preferences.dislike, [])
})

test('night scheduler has no first-run window', () => {
  const previous = process.env.BILI_WHALE_CONFIG
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-public-defaults-'))
  process.env.BILI_WHALE_CONFIG = path.join(dir, 'missing-config.json')
  try {
    assert.deepEqual(readNightConfig(dir).windows, [])
  } finally {
    if (previous === undefined) delete process.env.BILI_WHALE_CONFIG
    else process.env.BILI_WHALE_CONFIG = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('published example contains no personal preferences or active listeners', () => {
  const file = new URL('../tools/templates/config.example.json', import.meta.url)
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(config.preferences.like, [])
  assert.deepEqual(config.preferences.dislike, [])
  assert.equal(config.listen.comment, false)
  assert.equal(config.listen.dm, false)
  assert.equal(config.listen.live, false)
  assert.equal(config.share.enabled, false)
  assert.deepEqual(config.night.windows, [])
})
