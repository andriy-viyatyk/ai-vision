import { highlightOverlaySource } from "./highlight-source.generated.js";
import type { IAiElementRevealRequest, IAiHighlightApi, IAiHighlightOptions, IAiHighlightResult } from "./types.js";

declare global {
    interface Window {
        __aiVisionHighlight?: IAiHighlightApi;
    }
}

export function installHighlightOverlay(): IAiHighlightApi {
    if (typeof window === "undefined" || typeof document === "undefined") {
        throw new Error("The highlight overlay requires a browser document.");
    }
    const existing = window.__aiVisionHighlight;
    if (existing) return existing;

    const script = document.createElement("script");
    script.text = highlightOverlaySource;
    (document.head ?? document.documentElement).appendChild(script);
    script.remove();

    const installed = window.__aiVisionHighlight;
    if (!installed) throw new Error("The highlight overlay did not install.");
    return installed;
}

export function highlightElement(
    selector: string,
    message?: string,
    options: IAiHighlightOptions = {},
    reveal?: IAiElementRevealRequest,
): Promise<IAiHighlightResult> {
    const overlay = installHighlightOverlay();
    return Promise.resolve(overlay.show({
        ...options,
        selector,
        ...(message !== undefined ? { text: message } : {}),
        ...(reveal !== undefined ? { reveal } : {}),
    }));
}

