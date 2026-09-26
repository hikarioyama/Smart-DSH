import assert from 'node:assert/strict'
import test from 'node:test'
import { patchSessionSelectKeyboard } from './session-select-keyboard.mjs'

test('session select patch skips phone composer focus and is idempotent', () => {
  const source = [
    '\t\tfunction jr(t, e, n, o, r, s) {',
    '\t\t\t\t\t\tnull !== t && t !== n || r.has("skip-selection-focus") || s.focus({ preventScroll: !0 });',
    '\t\t\t\t\t\tnull !== e && e !== n || s.focus({ preventScroll: !0 });',
    '\t\t\t\tif (locked || editor === null) return;',
  ].join('\n')
  const first = patchSessionSelectKeyboard(source)
  assert.equal(first.changed, true)
  assert.match(first.source, /function phoneSkipsComposerFocus/)
  assert.equal(first.source.includes('if (locked || editor === null) return;'), false)
  assert.equal(first.source.includes('r.has("skip-selection-focus") || s.focus'), false)
  assert.equal(first.source.includes('null !== e && e !== n || s.focus'), false)
  const second = patchSessionSelectKeyboard(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})
