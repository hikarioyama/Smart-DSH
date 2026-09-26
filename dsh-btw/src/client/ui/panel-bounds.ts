/** Bookmarks / favorites bar kept clear of the BTW resize handle on phones. */
export const BOOKMARK_BAR_PX = 48
/** Desktop only needs the handle inside the viewport, not under a bookmarks bar. */
export const DESKTOP_TOP_GAP_PX = 8
export const MIN_TRANSCRIPT_PX = 100

export function isPhoneViewport(coarsePointer: boolean, width: number): boolean {
  return coarsePointer || width < 768
}

/**
 * Visual-viewport y the BTW panel top must stay at or below.
 * `getBoundingClientRect().top` is already visual-viewport-relative, so this
 * is a gap under the browser chrome. On a phone that gap covers a bookmarks
 * or favorites bar that overlays the visual viewport.
 */
export function btwTopLimit(phone: boolean, safeAreaTop = 0): number {
  return Math.max(0, safeAreaTop, phone ? BOOKMARK_BAR_PX : DESKTOP_TOP_GAP_PX)
}

/**
 * Transcript height that puts the panel top on `limit`.
 * Positive slack means the handle can still move up; negative slack means it
 * is already under the bookmarks bar and must shrink.
 */
export function transcriptHeightForTop(currentHeight: number, panelTop: number, limit: number, min = MIN_TRANSCRIPT_PX): number {
  return Math.max(min, Math.round(currentHeight + (panelTop - limit)))
}

export function clampHeight(height: number, viewport: number, measuredMax?: number): number {
  const byRatio = Math.max(MIN_TRANSCRIPT_PX, viewport * 0.7)
  const max = measuredMax === undefined ? byRatio : Math.min(byRatio, Math.max(MIN_TRANSCRIPT_PX, measuredMax))
  return Math.max(MIN_TRANSCRIPT_PX, Math.min(max, height))
}
