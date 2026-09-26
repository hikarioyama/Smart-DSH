/** Do not focus the composer when a phone selects a session. */

const HELPER = `function phoneSkipsComposerFocus() {
\t\t\treturn typeof window !== "undefined" && typeof window.matchMedia === "function" && (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 767px)").matches);
\t\t}
\t\t`

const EFFECT_GUARD = 'if (locked || editor === null) return;'
const EFFECT_PATCHED = 'if (locked || editor === null || phoneSkipsComposerFocus()) return;'
const LEXICAL_A = 'r.has("skip-selection-focus") || s.focus({ preventScroll: !0 });'
const LEXICAL_A_PATCHED = 'r.has("skip-selection-focus") || phoneSkipsComposerFocus() || s.focus({ preventScroll: !0 });'
const LEXICAL_B = 'null !== e && e !== n || s.focus({ preventScroll: !0 });'
const LEXICAL_B_PATCHED = 'null !== e && e !== n || phoneSkipsComposerFocus() || s.focus({ preventScroll: !0 });'

export function patchSessionSelectKeyboard(source) {
  const landed = source.includes('function phoneSkipsComposerFocus(')
    && source.includes(EFFECT_PATCHED)
    && source.includes(LEXICAL_A_PATCHED)
    && source.includes(LEXICAL_B_PATCHED)
  if (landed) return { source, state: 'patched', changed: false }
  if (!source.includes(EFFECT_GUARD)) throw new Error('composer session focus guard was not found')
  const anchor = '\t\tfunction jr(t, e, n, o, r, s) {'
  if (!source.includes(anchor)) throw new Error('lexical selection focus anchor was not found')
  if (!source.includes(LEXICAL_A) || !source.includes(LEXICAL_B)) throw new Error('lexical root focus calls were not found')
  let next = source.replace(anchor, `${HELPER}${anchor}`)
  next = next.replace(EFFECT_GUARD, EFFECT_PATCHED)
  next = next.replace(LEXICAL_A, LEXICAL_A_PATCHED)
  next = next.replace(LEXICAL_B, LEXICAL_B_PATCHED)
  if (next.includes(EFFECT_GUARD) || next.includes(LEXICAL_A) || next.includes(LEXICAL_B)) {
    throw new Error('a composer focus call was left unchanged')
  }
  return { source: next, state: 'patched', changed: true }
}
