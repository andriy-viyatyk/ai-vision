
/**
 * Best-effort human-readable message for an unknown catch value.
 */
export function errMessage(e: unknown, fallback = "Unexpected error"): string {
    if (typeof e === "string") return e.trim() || fallback;
    const message = (e as { message?: unknown } | null | undefined)?.message;
    if (typeof message === "string" && message.trim()) return message;
    if (e === null || e === undefined) return fallback;
    const text = String(e);
    return text && text !== "[object Object]" ? text : fallback;
}

/**
 * The machine-readable code of an unknown catch value: its own non-empty string `code`
 * (e.g. `Object.assign(new Error(message), { code: "rejected" })`), else `undefined`.
 */
export function errCode(e: unknown): string | undefined {
    if (typeof e !== "object" || e === null) return undefined;
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" && code.trim() ? code : undefined;
}
