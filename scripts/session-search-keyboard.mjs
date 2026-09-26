/** Do not focus the session search field from the magnifier on a phone. */

const HELPER = `function focusSessionSearch(node, options) {
\t\t\tconst phone = typeof window !== "undefined" && typeof window.matchMedia === "function" && (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 767px)").matches);
\t\t\tif (phone) return;
\t\t\tnode?.focus(options);
\t\t}
\t\t`

export function patchSessionSearchKeyboard(source) {
  if (!source.includes('searchInput.current?.focus')) {
    if (!source.includes('function focusSessionSearch(')) throw new Error('session search focus sites were not found')
    return { source, state: 'patched', changed: false }
  }
  let next = source
  if (!next.includes('function focusSessionSearch(')) {
    const anchor = '\t\tconst EXPAND_SLIDE_MS = 300;'
    if (!next.includes(anchor)) throw new Error('EXPAND_SLIDE_MS anchor was not found')
    next = next.replace(anchor, `${HELPER}${anchor}`)
  }
  next = next.replaceAll('searchInput.current?.focus({ preventScroll: true })', 'focusSessionSearch(searchInput.current, { preventScroll: true })')
  next = next.replaceAll('searchInput.current?.focus()', 'focusSessionSearch(searchInput.current)')
  if (next.includes('searchInput.current?.focus')) throw new Error('a session search focus call was left unchanged')
  return { source: next, state: 'patched', changed: next !== source }
}
