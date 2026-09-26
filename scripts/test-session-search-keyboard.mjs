import assert from 'node:assert/strict'
import test from 'node:test'
import { patchSessionSearchKeyboard } from './session-search-keyboard.mjs'

test('session search patch skips phone focus and is idempotent', () => {
  const source = [
    '\t\tconst EXPAND_SLIDE_MS = 300;',
    'searchInput.current?.focus({ preventScroll: true });',
    'searchInput.current?.focus();',
  ].join('\n')
  const first = patchSessionSearchKeyboard(source)
  assert.equal(first.changed, true)
  assert.match(first.source, /function focusSessionSearch/)
  assert.equal(first.source.includes('searchInput.current?.focus'), false)
  const second = patchSessionSearchKeyboard(first.source)
  assert.equal(second.changed, false)
})
