import { type CSSProperties } from 'react';
import type { BtwController } from '../controller.js';
export interface BtwOverlayInjected {
    readonly controller: BtwController;
    readonly dockStyle?: CSSProperties;
    readonly openChild?: (id: string) => Promise<void>;
}
export { clampHeight } from './panel-bounds.js';
/** Local layout only: no hashed upstream CSS selectors or document listeners. */
export declare function BtwOverlay({ controller, openChild, dockStyle }: BtwOverlayInjected): import("react").JSX.Element | null;
