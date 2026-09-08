/** Return the first timeout value that is defined, from most to least specific. */
export function resolveTimeoutMs(
    perCall: number | undefined,
    declared: number | undefined,
    runtime: number | undefined,
    fallback: number,
): number {
    return perCall ?? declared ?? runtime ?? fallback;
}

