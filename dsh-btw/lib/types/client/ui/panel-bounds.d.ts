/** Bookmarks / favorites bar kept clear of the BTW resize handle on phones. */
export declare const BOOKMARK_BAR_PX = 48;
/** Desktop only needs the handle inside the viewport, not under a bookmarks bar. */
export declare const DESKTOP_TOP_GAP_PX = 8;
export declare const MIN_TRANSCRIPT_PX = 100;
export declare function isPhoneViewport(coarsePointer: boolean, width: number): boolean;
/**
 * Visual-viewport y the BTW panel top must stay at or below.
 * `getBoundingClientRect().top` is already visual-viewport-relative, so this
 * is a gap under the browser chrome. On a phone that gap covers a bookmarks
 * or favorites bar that overlays the visual viewport.
 */
export declare function btwTopLimit(phone: boolean, safeAreaTop?: number): number;
/**
 * Transcript height that puts the panel top on `limit`.
 * Positive slack means the handle can still move up; negative slack means it
 * is already under the bookmarks bar and must shrink.
 */
export declare function transcriptHeightForTop(currentHeight: number, panelTop: number, limit: number, min?: number): number;
export declare function clampHeight(height: number, viewport: number, measuredMax?: number): number;
