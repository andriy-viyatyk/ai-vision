export interface IAiEvent {
    readonly seq: number;
    readonly time: string;
    readonly kind: string;
    readonly path?: string;
    readonly text: string;
    readonly origin: string;
}

export interface IAiEventsBlock {
    /** The formatted block a host puts in `ICallResult.events`. */
    readonly text: string;
    /** The cursor value the caller should store: the newest delivered seq. */
    readonly cursor: number;
    /** How many entries the text lists in full. */
    readonly shown: number;
    /** How many entries were unseen in total (>= shown). */
    readonly unseen: number;
    /** True when the caller's cursor had fallen off the tail of the ring. */
    readonly dropped: boolean;
}

export interface IEventLogOptions {
    /** Ring capacity; oldest entries are discarded past it. Default 200, minimum 1. */
    readonly cap?: number;
    /** The host's own origin name. Entries with a different `origin` are rendered with an
     *  attribution suffix, so text written by an untrusted remote is always labelled. Default "host". */
    readonly hostOrigin?: string;
}

export type IAiHostSignal =
    | { readonly type: "shape"; readonly version: number; readonly schemaVersion: number }
    | { readonly type: "notify"; readonly text: string };

/** The global a host installs (e.g. through CDP `Runtime.addBinding`) to hear from a page.
 *  It takes ONE string argument - a JSON-encoded `IAiHostSignal` - because that is all
 *  a CDP binding can carry. */
export const AI_VISION_HOST_SIGNAL = "__aiVisionHostSignal";

export class EventLog {
    private readonly cap: number;
    private readonly hostOrigin: string;
    private readonly entries: IAiEvent[] = [];
    private readonly listeners = new Set<(entry: IAiEvent) => void>();
    private nextSeq = 1;

    public constructor(options: IEventLogOptions = {}) {
        const requestedCap = options.cap ?? 200;
        this.cap = Number.isFinite(requestedCap) ? Math.max(1, Math.floor(requestedCap)) : 200;
        this.hostOrigin = options.hostOrigin ?? "host";
    }

    public get count(): number {
        return this.entries.length;
    }

    public get lastSeq(): number {
        return this.nextSeq - 1;
    }

    public push(entry: {
        kind: string;
        text: string;
        origin?: string;
        path?: string;
        time?: string;
    }): IAiEvent {
        const stored: IAiEvent = {
            seq: this.nextSeq++,
            time: entry.time ?? new Date().toISOString(),
            kind: entry.kind,
            ...(entry.path !== undefined ? { path: entry.path } : {}),
            text: entry.text,
            origin: entry.origin ?? this.hostOrigin,
        };
        this.entries.push(stored);
        if (this.entries.length > this.cap) this.entries.shift();
        for (const listener of this.listeners) {
            try {
                listener(stored);
            } catch {
                // A subscriber cannot prevent the event from being logged or delivered.
            }
        }
        return stored;
    }

    public recent(limit = 50): readonly IAiEvent[] {
        const count = normalizeLimit(limit);
        return this.entries.slice(Math.max(0, this.entries.length - count)).reverse();
    }

    public since(seq: number, limit?: number): readonly IAiEvent[] {
        const found = this.entries.filter(entry => entry.seq > seq);
        return limit === undefined ? found : found.slice(0, normalizeLimit(limit));
    }

    public unseen(cursor: number): { entries: readonly IAiEvent[]; dropped: boolean } {
        const oldest = this.entries[0];
        return {
            entries: this.entries.filter(entry => entry.seq > cursor),
            dropped: oldest !== undefined && cursor < oldest.seq - 1,
        };
    }

    public format(cursor: number, showCount = 3): IAiEventsBlock | undefined {
        const unseen = this.unseen(cursor);
        if (!unseen.entries.length) return undefined;

        const shownCount = Math.min(normalizeLimit(showCount), unseen.entries.length);
        const shownEntries = unseen.entries.slice(unseen.entries.length - shownCount);
        const lines: string[] = [];
        if (unseen.dropped) {
            lines.push("Older events were dropped from the log; read events.recent() for what is still held.");
        }
        lines.push("Events since your last call:");
        for (const entry of shownEntries) lines.push("  [seq " + entry.seq + "] " + this.render(entry));
        const earlier = unseen.entries.length - shownCount;
        if (earlier > 0) {
            lines.push("+" + earlier + " earlier " + (earlier === 1 ? "event" : "events") + "; read events.recent().");
        }
        return {
            text: lines.join("\n"),
            cursor: unseen.entries[unseen.entries.length - 1].seq,
            shown: shownCount,
            unseen: unseen.entries.length,
            dropped: unseen.dropped,
        };
    }

    public subscribe(listener: (entry: IAiEvent) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private render(entry: IAiEvent): string {
        const text = /[.!?]$/.test(entry.text) ? entry.text : entry.text + ".";
        return entry.origin === this.hostOrigin
            ? text
            : text + " (written by the " + entry.origin + ", not by " + this.hostOrigin + ")";
    }
}

function normalizeLimit(limit: number): number {
    if (limit === Infinity) return Number.MAX_SAFE_INTEGER;
    if (!Number.isFinite(limit)) return 0;
    return Math.max(0, Math.floor(limit));
}
