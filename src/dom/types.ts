import type { IAiElementDeclaration } from "../core/types.js";

export interface IAiHighlightOptions {
    /** Explanatory text shown in the callout card. Omit (with no `title`) for a bare ring. */
    text?: string;
    /** Bold heading above the text. */
    title?: string;
    /** Highlight every match instead of only the first (capped at 20 rings). Defaults to false. */
    all?: boolean;
    /** Scroll the target into view first. Defaults to true. */
    scroll?: boolean;
    /** Reuse an id to replace an existing highlight instead of stacking a second one. */
    id?: string;
    /** Button labels for the callout card. When given, they REPLACE the default single Close
     *  button, in order. Pressing one clears the highlight and calls `onButton`. */
    buttons?: readonly string[];
    /** Called with the pressed label. Same-realm only: a callback cannot cross a CDP evaluate. */
    onButton?: (label: string, id: string) => void;
}

export interface IAiHighlightResult {
    /** The highlight's id — pass it to `clearHighlights(id)` to remove just this one. */
    id: string;
    /** Whether the selector matched anything. */
    found: boolean;
    /** How many elements the selector matched (may exceed the number highlighted). */
    count: number;
    /** How many were actually ringed (1 unless `all: true`; capped at 20). */
    highlighted?: number;
    /** The selector that was used. */
    selector: string | null;
    /** Present only when the selector was malformed or missing. */
    error?: string;
}

/** Internal request for a declaration-scoped temporary reveal. */
export interface IAiElementRevealRequest {
    readonly selector: string;
    readonly display: string;
}

export interface IAiHighlightApi {
    readonly version: number;
    show(options: IAiHighlightOptions & { selector: string; reveal?: IAiElementRevealRequest }): IAiHighlightResult;
    clear(id?: string): number;
}

export interface CreateElementsOptions {
    readonly itemLabel?: string;
    readonly validNamesLabel?: string;
    readonly unknownNameError?: (name: string, declarations: readonly IAiElementDeclaration[]) => string | undefined;
    readonly scopeSelector?: string;
    readonly scopeRootNames?: readonly string[];
    readonly beforeHighlight?: (selector: string) => void | Promise<void>;
    readonly highlightOptions?: IAiHighlightOptions;
}
