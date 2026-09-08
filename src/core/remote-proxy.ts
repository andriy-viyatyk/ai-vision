import type {
    IAiMember,
    IAiElementDeclaration,
    IAiVisible,
    IAiVisionDescriptor,
} from "./types.js";
import type { IAiChild } from "./types.js";
import type {
    IAiMemberShape,
    IAiNodeShape,
    IAiRemoteRequest,
    IAiRemoteResponse,
    IAiVisionShape,
} from "./remote-types.js";

export interface IRemoteProxyOptions {
    readonly restricted?: () => string | undefined;
    readonly originNote?: string;
    readonly onWarning?: (message: string) => void;
    readonly onError?: (error: unknown) => void;
    /** Called before every remote request. Resolve `true` or `undefined` to proceed; `false` to
     *  fail the request with a default "the remote shape changed" error; a string to fail it with
     *  that message. Lets a host revalidate a cached shape lazily instead of trusting an event. */
    readonly revalidate?: () => Promise<boolean | string | undefined>;
}

type RemoteSender = (request: IAiRemoteRequest) => Promise<IAiRemoteResponse>;
type RemoteNode = IAiVisible & { readonly __aiVisionPath?: string };

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const STALE_REMOTE_SHAPE_MESSAGE = "The remote model's shape changed since this reference was built; read its path again to pick up the new one.";

export function createRemoteProxy(
    shape: IAiVisionShape,
    send: RemoteSender,
    options: IRemoteProxyOptions = {},
): IAiVisible {
    const onWarning = options.onWarning ?? ((message: string) => console.warn(message));
    return buildNode(shape.root, "", undefined);

    function buildNode(
        nodeShape: IAiNodeShape,
        path: string,
        memberIndexable: boolean | undefined,
        declaredTimeoutMs: number | undefined = undefined,
    ): IAiVisible {
        const members = sanitizeMembers(nodeShape.members, onWarning);
        const elements = sanitizeElements(nodeShape.elements, onWarning);
        const descriptorMembers: IAiMember[] = members.map(member => ({
            name: member.name,
            kind: member.kind,
            summary: member.summary,
            ...(member.signature !== undefined ? { signature: member.signature } : {}),
            ...(member.caution !== undefined ? { caution: member.caution } : {}),
            ...(member.writable !== undefined ? { writable: member.writable } : {}),
            ...(member.node !== undefined ? { node: true } : {}),
        }));

        const descriptor: IAiVisionDescriptor = {
            kind: nodeShape.kind,
            summary: nodeShape.summary,
            members: descriptorMembers,
            ...(nodeShape.overview !== undefined ? { overview: nodeShape.overview } : {}),
            ...(nodeShape.elements !== undefined ? { elements } : {}),
            ...(nodeShape.help !== undefined ? {
                help: options.originNote
                    ? `${nodeShape.help}\n\n${options.originNote}`
                    : nodeShape.help,
            } : options.originNote ? { help: options.originNote } : {}),
            ...(nodeShape.hasChildren ? { children: () => requestChildren(path) } : {}),
            ...(options.restricted ? { restricted: options.restricted } : {}),
            ...(nodeShape.indexable || memberIndexable ? { index: key => buildIndexed(nodeShape, path, key, declaredTimeoutMs) } : {}),
            summarize: () => requestValue(path, declaredTimeoutMs),
            provide: name => provide(name, path, members, nodeShape),
        };

        const proxy: RemoteNode = { aiVision: descriptor, __aiVisionPath: path };
        for (const member of members) {
            if (member.kind !== "property" || !member.writable) continue;
            Object.defineProperty(proxy, member.name, {
                configurable: true,
                enumerable: false,
                set: (value: unknown) => {
                    void sendRequest({
                        action: "ai:set",
                        path: appendMember(path, member.name),
                        value,
                        ...(member.timeoutMs !== undefined ? { timeoutMs: member.timeoutMs } : {}),
                    }).catch(error => options.onError?.(error));
                },
            });
        }
        return proxy;
    }

    function provide(
        name: string,
        path: string,
        members: readonly IAiMemberShape[],
        nodeShape: IAiNodeShape,
    ): { value: unknown } | undefined {
        const member = members.find(item => item.name === name);
        if (!member) {
            if (!nodeShape.hasChildren) return undefined;
            return {
                value: sendRequest({
                    action: "ai:get",
                    path: appendMember(path, name),
                }),
            };
        }

        if (name === "elements") {
            return {
                value: sendRequest({
                    action: "ai:elements",
                    path,
                    ...(member.timeoutMs !== undefined ? { timeoutMs: member.timeoutMs } : {}),
                }),
            };
        }
        if (name === "highlight" && member.kind === "method") {
            return {
                value: (elementName: string, message?: string): Promise<unknown> =>
                    sendRequest({
                        action: "ai:highlight",
                        path,
                        name: elementName,
                        ...(message !== undefined ? { message } : {}),
                        ...(member.timeoutMs !== undefined ? { timeoutMs: member.timeoutMs } : {}),
                    }),
            };
        }
        if (member.node) {
            return {
                value: buildNode(
                    member.node,
                    appendMember(path, name),
                    member.indexable,
                    member.timeoutMs,
                ),
            };
        }
        if (member.indexable) {
            return {
                value: buildNode(
                    {
                        kind: "RemoteCollection",
                        summary: member.summary,
                        members: [],
                        indexable: true,
                        ...(member.item !== undefined ? { item: member.item } : {}),
                    },
                    appendMember(path, name),
                    true,
                    member.timeoutMs,
                ),
            };
        }
        if (member.kind === "method") {
            return {
                value: (...args: unknown[]) => sendRequest({
                    action: "ai:invoke",
                    path: appendMember(path, name),
                    args,
                    ...(member.timeoutMs !== undefined ? { timeoutMs: member.timeoutMs } : {}),
                }),
            };
        }
        return {
            value: sendRequest({
                action: "ai:get",
                path: appendMember(path, name),
                ...(member.timeoutMs !== undefined ? { timeoutMs: member.timeoutMs } : {}),
            }),
        };
    }

    function buildIndexed(
        nodeShape: IAiNodeShape,
        path: string,
        key: string | number,
        declaredTimeoutMs: number | undefined,
    ): IAiVisible | Promise<unknown> {
        const itemPath = appendIndex(path, key);
        if (!nodeShape.item) {
            return sendRequest({
                action: "ai:get",
                path: itemPath,
                ...(declaredTimeoutMs !== undefined ? { timeoutMs: declaredTimeoutMs } : {}),
            });
        }
        return buildNode(nodeShape.item, itemPath, undefined, declaredTimeoutMs);
    }

    function requestChildren(path: string): Promise<readonly IAiChild[]> {
        return sendRequest({ action: "ai:children", path }).then(result => {
            if (!Array.isArray(result)) {
                onWarning(`Remote children for "${path || "(root)"}" were not an array; ignored.`);
                return [];
            }
            return result as readonly IAiChild[];
        });
    }

    function requestValue(path: string, timeoutMs: number | undefined): Promise<unknown> {
        return sendRequest({
            action: "ai:get",
            path,
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
    }

    async function sendRequest(request: IAiRemoteRequest): Promise<unknown> {
        const validation = await options.revalidate?.();
        if (validation === false) throw new Error(STALE_REMOTE_SHAPE_MESSAGE);
        if (typeof validation === "string" && validation) throw new Error(validation);
        const response = await send(request);
        if (!response.ok) throw new Error(response.error);
        return response.result;
    }

    function appendMember(path: string, name: string): string {
        return path ? `${path}.${name}` : name;
    }

    function appendIndex(path: string, key: string | number): string {
        return `${path}[${JSON.stringify(key)}]`;
    }
}

function sanitizeMembers(
    members: readonly IAiMemberShape[],
    onWarning: (message: string) => void,
): IAiMemberShape[] {
    const seen = new Set<string>();
    const valid: IAiMemberShape[] = [];
    for (const member of members ?? []) {
        if (!member || typeof member.name !== "string" || !IDENTIFIER.test(member.name) || member.name === "$help") {
            onWarning(`Ignoring invalid remote member name ${JSON.stringify(member?.name)}.`);
            continue;
        }
        if (member.kind !== "property" && member.kind !== "method") {
            onWarning(`Ignoring remote member "${member.name}" with invalid kind.`);
            continue;
        }
        if (seen.has(member.name)) {
            onWarning(`Ignoring duplicate remote member "${member.name}".`);
            continue;
        }
        seen.add(member.name);
        valid.push(member);
    }
    return valid;
}

function sanitizeElements(
    elements: readonly IAiElementDeclaration[] | undefined,
    onWarning: (message: string) => void,
): readonly IAiElementDeclaration[] {
    const seen = new Set<string>();
    const valid = [];
    for (const element of elements ?? []) {
        if (!element || typeof element.name !== "string" || !element.name
            || element.name.includes('"') || element.name.includes("\\")) {
            onWarning("Ignoring invalid remote element name " + JSON.stringify(element?.name) + ".");
            continue;
        }
        if (seen.has(element.name)) {
            onWarning("Ignoring duplicate remote element " + JSON.stringify(element.name) + ".");
            continue;
        }
        seen.add(element.name);
        valid.push(element);
    }
    return valid;
}
