import assert from 'node:assert/strict'
import test from 'node:test'
import { ORIGINAL, patchClaimTokenColor } from './claim-token-color.mjs'

test('claim color patch paints only the command and is idempotent', () => {
  const first = patchClaimTokenColor(`before\n${ORIGINAL}\nafter`)
  assert.equal(first.changed, true)
  assert.match(first.source, /paintLength/)
  assert.doesNotMatch(first.source, /splitText\(token\.length\)/)
  const second = patchClaimTokenColor(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})
