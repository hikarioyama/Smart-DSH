import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const start = src.indexOf('@media (max-width: 767px)')
const end = src.indexOf('}`;', start)
const mobile = src.slice(start, end)

test('narrow phones size question cards from the viewport, not the 680px floor', () => {
  assert.ok(start > 0)
  assert.match(mobile, /--dsh-chat-content-width:\s*100% !important/)
  assert.match(mobile, /--dsh-chat-user-width:\s*100% !important/)
  assert.match(mobile, /max-width:\s*min\(100%, 95vw\)/)
  assert.match(mobile, /padding-left:\s*2\.5%/)
  assert.match(mobile, /\[data-question-key\]/)
  assert.match(mobile, /\[data-plan-review-key\]/)
  assert.doesNotMatch(src.slice(end), /95vw/)
})
