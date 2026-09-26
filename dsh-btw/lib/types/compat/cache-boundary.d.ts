export interface CacheBoundaryResult {
    readonly payload: unknown;
    readonly moved: boolean;
}
/**
 * pi-ai marks the final user block. A fire-and-forget BTW tail has no future
 * consumer, so move that marker to the last cacheable block in the shared
 * prefix. The input object is never mutated.
 */
export declare function shiftAnthropicCacheBoundary(payload: unknown): CacheBoundaryResult;
