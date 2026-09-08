import type { IAiElementRevealRequest, IAiHighlightApi, IAiHighlightOptions, IAiHighlightResult } from "./types.js";

export type { IAiElementRevealRequest, IAiHighlightApi, IAiHighlightOptions, IAiHighlightResult };

declare global {
    interface Window {
        __aiVisionHighlight?: IAiHighlightApi;
    }
}

