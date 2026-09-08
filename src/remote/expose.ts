import {
    AI_VISION_HOST_SIGNAL,
    AI_VISION_SCHEMA_VERSION,
    buildHelp,
    errMessage,
    formatPath,
    getAiVision,
    parsePath,
    shapeResult,
} from "../core/index.js";
import type {
    IAiHostSignal,
    IAiElementDeclaration,
    IAiMember,
    IAiMemberShape,
    IAiNodeShape,
    IAiRemoteRequest,
    IAiRemoteResponse,
    IAiVisionDescriptor,
    IAiVisionShape,
} from "../core/index.js";

export interface IExposeOptions {
    readonly publish?: boolean;
    readonly onWarning?: (message: string) => void;
    /** Where change and notify signals go. Defaults to calling `window[hostSignalName]` with the
     *  JSON-encoded signal when such a function exists, and doing nothing when it does not. */
    readonly onHostSignal?: (signal: IAiHostSignal) => void;
    /** Name of the global the default transport calls. Defaults to AI_VISION_HOST_SIGNAL. */
    readonly hostSignalName?: string;
}

export interface IAiVisionRemote {
    readonly schemaVersion: number;
    readonly version: number;
    describe(): IAiVisionShape;
    handle(request: IAiRemoteRequest): Promise<IAiRemoteResponse>;
    refresh(): void;
    notify(text: string): void;
    dispose(): void;
}

declare global {
    interface Window {
        __aiVision?: IAiVisionRemote;
    }
}

type ParsedPath = ReturnType<typeof parsePath>;

export function expose(root: object, options: IExposeOptions = {}): IAiVisionRemote {
    const onWarning = options.onWarning ?? ((message: string) => console.warn(message));
    const hostSignalName = options.hostSignalName ?? AI_VISION_HOST_SIGNAL;
    let shape = describeRoot(root, onWarning);
    let version = 1;
    let disposed = false;

    const remote: IAiVisionRemote = {
        schemaVersion: AI_VISION_SCHEMA_VERSION,
        get version() {
            return version;
        },
        describe: () => shape,
        handle: request => handleRequest(root, request),
        refresh: () => {
            if (!disposed) {
                shape = describeRoot(root, onWarning);
                version++;
                emitSignal({ type: "shape", version, schemaVersion: AI_VISION_SCHEMA_VERSION });
            }
        },
        notify: text => {
            if (!disposed) emitSignal({ type: "notify", text: String(text) });
        },
        dispose: () => {
            disposed = true;
            if (typeof window !== "undefined" && window.__aiVision === remote) {
                delete window.__aiVision;
            }
        },
    };

    if (options.publish !== false && typeof window !== "undefined") {
        window.__aiVision = remote;
    }
    return remote;

    function emitSignal(signal: IAiHostSignal): void {
        try {
            if (options.onHostSignal) {
                options.onHostSignal(signal);
                return;
            }
            if (typeof window === "undefined") return;
            const transport = (window as unknown as Record<string, unknown>)[hostSignalName];
            if (typeof transport === "function") {
                (transport as (payload: string) => void).call(window, JSON.stringify(signal));
            }
        } catch (error) {
            try {
                onWarning("Could not deliver AiVision host signal: " + errMessage(error));
            } catch {
                // Warning handlers must not make signal delivery observable to the caller.
            }
        }
    }

    async function handleRequest(modelRoot: object, request: IAiRemoteRequest): Promise<IAiRemoteResponse> {
        if (disposed) return { ok: false, error: "The AiVision remote has been disposed." };
        try {
            if (request.action === "ai:children") {
                const node = await resolvePath(modelRoot, request.path);
                assertNotRestricted(node);
                const descriptor = getAiVision(node);
                const result = descriptor?.children ? await descriptor.children() : [];
                return shapedSuccess(result, request.maxLength);
            }

            if (request.action === "ai:elements" || request.action === "ai:highlight") {
                const node = await resolvePath(modelRoot, request.path);
                assertNotRestricted(node);
                const descriptor = getAiVision(node);
                const name = request.action === "ai:elements" ? "elements" : "highlight";
                const provided = descriptor?.provide?.(name);
                if (!provided) throw new Error(request.action + " is not available at " + request.path + ".");
                if (request.action === "ai:highlight") {
                    if (typeof provided.value !== "function") throw new Error("The remote highlight member is not callable.");
                    const result = await (provided.value as (name: string, message?: string) => unknown)(
                        request.name ?? "",
                        request.message,
                    );
                    return shapedSuccess(result, request.maxLength);
                }
                return shapedSuccess(await provided.value, request.maxLength);
            }

            const segments = parsePath(request.path);
            if (request.action === "ai:set") {
                const last = segments.at(-1);
                if (!last || last.type !== "member") throw new Error("A set request must end in a property name.");
                const parent = await resolvePath(modelRoot, segments.slice(0, -1));
                assertNotRestricted(parent);
                const descriptor = getAiVision(parent);
                const member = descriptor?.members.find(item => item.name === last.name);
                if (descriptor && !member) throw new Error('"' + last.name + '" is not a declared member of ' + descriptor.kind + ".");
                if (descriptor && !member?.writable) throw new Error('"' + last.name + '" is not writable on ' + descriptor.kind + ".");
                const currentValue = (parent as Record<string, unknown>)[last.name];
                const incomingIsStructured = typeof request.value === "object" && request.value !== null;
                const valueToAssign = incomingIsStructured && typeof currentValue === "string"
                    ? JSON.stringify(request.value, null, 2)
                    : request.value;
                (parent as Record<string, unknown>)[last.name] = valueToAssign;
                return shapedSuccess({ ok: true }, request.maxLength);
            }

            if (request.action === "ai:invoke") {
                const result = await invokePath(modelRoot, request.path, request.args ?? []);
                return shapedSuccess(result, request.maxLength);
            }

            const resolved = await resolvePath(modelRoot, request.path);
            const descriptor = getAiVision(resolved);
            const result = descriptor?.summarize
                ? await descriptor.summarize()
                : resolved;
            return shapedSuccess(result, request.maxLength);
        } catch (error) {
            return { ok: false, error: errMessage(error) };
        }
    }
}

function describeRoot(root: object, onWarning: (message: string) => void): IAiVisionShape {
    const descriptor = getAiVision(root);
    if (!descriptor) throw new Error("The exposed root must carry an AiVision descriptor.");
    return {
        schemaVersion: AI_VISION_SCHEMA_VERSION,
        root: describeNode(root, descriptor, onWarning, new WeakSet<object>()),
    };
}

function describeNode(
    target: unknown,
    descriptor: IAiVisionDescriptor,
    onWarning: (message: string) => void,
    visiting: WeakSet<object>,
): IAiNodeShape {
    const objectTarget = target && (typeof target === "object" || typeof target === "function")
        ? target as object
        : undefined;
    if (objectTarget) visiting.add(objectTarget);

    const members: IAiMemberShape[] = [];
    for (const member of descriptor.members) {
        try {
            const remoteFields = readRemoteMemberFields(member);
            const nested = (member.node === true || remoteFields.indexable === true)
                ? readMember(target, descriptor, member.name)
                : undefined;
            const nestedDescriptor = nested === undefined ? undefined : getAiVision(nested);
            let nestedShape: IAiNodeShape | undefined;
            let itemShape: IAiNodeShape | undefined;
            if (member.node === true && nestedDescriptor && nested &&
                (typeof nested === "object" || typeof nested === "function")) {
                if (visiting.has(nested)) {
                    onWarning('Skipping cyclic AiVision node member "' + member.name + '".');
                } else {
                    nestedShape = describeNode(nested, nestedDescriptor, onWarning, visiting);
                }
            }
            if (remoteFields.indexable === true) {
                itemShape = nestedShape?.item
                    ?? (nestedDescriptor ? describeIndexedItem(nestedDescriptor, onWarning, visiting) : undefined);
            }
            const memberShape: IAiMemberShape = {
                name: member.name,
                kind: member.kind,
                summary: member.summary,
                ...(member.signature !== undefined ? { signature: member.signature } : {}),
                ...(member.caution !== undefined ? { caution: member.caution } : {}),
                ...(member.writable !== undefined ? { writable: member.writable } : {}),
                ...remoteFields,
                ...(nestedShape ? { node: nestedShape } : {}),
                ...(itemShape ? { item: itemShape } : {}),
            };
            members.push(memberShape);
        } catch (error) {
            onWarning('Skipping AiVision member "' + member.name + '" while describing it: ' + errMessage(error));
        }
    }

    const help = resolveHelp(descriptor, onWarning);
    const elements = descriptor.elements?.map(copyElement);
    const item = descriptor.index
        ? describeIndexedItem(descriptor, onWarning, visiting)
        : undefined;
    const result: IAiNodeShape = {
        kind: descriptor.kind,
        summary: descriptor.summary,
        ...(descriptor.overview !== undefined ? { overview: descriptor.overview } : {}),
        ...(help !== undefined ? { help } : {}),
        members,
        ...(elements ? { elements } : {}),
        ...(descriptor.index ? { indexable: true } : {}),
        ...(descriptor.children ? { hasChildren: true } : {}),
        ...(item ? { item } : {}),
    };
    if (objectTarget) visiting.delete(objectTarget);
    return result;
}

function describeIndexedItem(
    descriptor: IAiVisionDescriptor,
    onWarning: (message: string) => void,
    visiting: WeakSet<object>,
): IAiNodeShape | undefined {
    // This probe is why descriptor.index() must be a cheap, side-effect-free lookup.
    let item: unknown;
    try {
        item = descriptor.index?.(0);
    } catch (error) {
        onWarning("Could not probe an indexed AiVision item for " + descriptor.kind + ": " + errMessage(error));
        return undefined;
    }
    const itemDescriptor = getAiVision(item);
    if (!itemDescriptor) return undefined;
    if (item && (typeof item === "object" || typeof item === "function") && visiting.has(item)) {
        onWarning("Skipping cyclic indexed AiVision item for " + descriptor.kind + ".");
        return undefined;
    }
    return describeNode(item, itemDescriptor, onWarning, visiting);
}

function readRemoteMemberFields(member: IAiMember): Pick<IAiMemberShape, "indexable" | "timeoutMs"> {
    const extended = member as IAiMember & { readonly indexable?: boolean; readonly timeoutMs?: number };
    return {
        ...(extended.indexable !== undefined ? { indexable: extended.indexable } : {}),
        ...(extended.timeoutMs !== undefined ? { timeoutMs: extended.timeoutMs } : {}),
    };
}

function copyElement(element: IAiElementDeclaration): IAiElementDeclaration {
    return {
        name: element.name,
        purpose: element.purpose,
        ...(element.where !== undefined ? { where: element.where } : {}),
        ...(element.selector !== undefined ? { selector: element.selector } : {}),
        ...(element.reveal !== undefined ? { reveal: { ...element.reveal } } : {}),
    };
}

function resolveHelp(descriptor: IAiVisionDescriptor, onWarning: (message: string) => void): string | undefined {
    try {
        const help = typeof descriptor.help === "function" ? descriptor.help() : descriptor.help;
        return help;
    } catch (error) {
        onWarning("Could not resolve AiVision help for " + descriptor.kind + ": " + errMessage(error));
        return undefined;
    }
}

function readMember(target: unknown, descriptor: IAiVisionDescriptor | undefined, name: string): unknown {
    const provided = descriptor?.provide?.(name);
    if (provided) return provided.value;
    if (!target || (typeof target !== "object" && typeof target !== "function")) return undefined;
    return (target as Record<string, unknown>)[name];
}

async function resolvePath(root: unknown, path: string | ParsedPath): Promise<unknown> {
    const segments = typeof path === "string" ? parsePath(path) : path;
    let current: unknown = root;
    const walked: ParsedPath = [];
    for (const segment of segments) {
        const descriptor = getAiVision(current);
        if (segment.type === "help") {
            if (!descriptor) throw new Error('"' + formatPath(walked) + '" has no AiVision descriptor.');
            return buildHelp(formatPath(walked), descriptor);
        }
        const restricted = descriptor?.restricted?.();
        if (restricted) throw new Error(restricted);
        if (segment.type === "index") {
            current = await indexInto(current, descriptor, segment.key);
            if (current === undefined) {
                throw new Error("No item " + JSON.stringify(segment.key) + ' in "' + (formatPath(walked) || "(root)") + '".');
            }
            walked.push(segment);
            continue;
        }
        if (!current || (typeof current !== "object" && typeof current !== "function")) {
            throw new Error('"' + formatPath(walked) + '" is a primitive value.');
        }
        const member = descriptor?.members.find(item => item.name === segment.name);
        if (descriptor && !member && !await liveChild(descriptor, segment.name)) {
            throw new Error('"' + segment.name + '" is not a declared member of ' + descriptor.kind + ".");
        }
        const value = readMember(current, descriptor, segment.name);
        if (segment.type === "call") {
            if (typeof value !== "function") throw new Error('"' + segment.name + '" is not callable.');
            current = await (value as (...args: unknown[]) => unknown).apply(current, segment.args);
        } else {
            current = value;
        }
        walked.push(segment);
    }
    return current;
}

async function invokePath(root: object, path: string, args: readonly unknown[]): Promise<unknown> {
    const segments = parsePath(path);
    if (!segments.length) throw new Error("An invoke request needs a method path.");
    const last = segments.at(-1);
    if (!last || last.type !== "member") return resolvePath(root, segments);
    const parent = await resolvePath(root, segments.slice(0, -1));
    assertNotRestricted(parent);
    const descriptor = getAiVision(parent);
    const member = descriptor?.members.find(item => item.name === last.name);
    if (descriptor && (!member || member.kind !== "method")) {
        throw new Error('"' + last.name + '" is not a declared method.');
    }
    const value = readMember(parent, descriptor, last.name);
    if (typeof value !== "function") throw new Error('"' + last.name + '" is not callable.');
    return (value as (...args: unknown[]) => unknown).apply(parent, Array.from(args));
}

function assertNotRestricted(node: unknown): void {
    const restricted = getAiVision(node)?.restricted?.();
    if (restricted) throw new Error(restricted);
}

async function indexInto(
    current: unknown,
    descriptor: IAiVisionDescriptor | undefined,
    key: string | number,
): Promise<unknown> {
    if (descriptor?.index) return await descriptor.index(key);
    if (Array.isArray(current)) return typeof key === "number" ? current[key] : undefined;
    if (current instanceof Map) return current.get(key);
    if (current && typeof current === "object") return (current as Record<string, unknown>)[String(key)];
    return undefined;
}

async function liveChild(descriptor: IAiVisionDescriptor, name: string): Promise<boolean> {
    const children = await descriptor.children?.() ?? [];
    return children.some(child => child.segment === "." + name || child.segment.startsWith("." + name + "("));
}

function shapedSuccess(value: unknown, maxLength: number | undefined): IAiRemoteResponse {
    return { ok: true, ...shapeResult(value, maxLength) };
}
