import type { IAiElementDeclaration, IAiMember } from "./types.js";

export interface IAiVisionShape {
    readonly schemaVersion: number;
    readonly root: IAiNodeShape;
}

export interface IAiNodeShape {
    readonly kind: string;
    readonly summary: string;
    readonly overview?: string;
    readonly help?: string;
    readonly members: readonly IAiMemberShape[];
    readonly elements?: readonly IAiElementDeclaration[];
    readonly indexable?: boolean;
    readonly hasChildren?: boolean;
    /** Shape of one indexed item, when this node is indexable and the item is a described node. */
    readonly item?: IAiNodeShape;
}

export interface IAiMemberShape extends Pick<IAiMember, "name" | "kind" | "summary" | "signature" | "caution" | "writable"> {
    readonly indexable?: boolean;
    readonly timeoutMs?: number;
    readonly node?: IAiNodeShape;
    /** Shape of one indexed item, when this member is indexable and the item is a described node. */
    readonly item?: IAiNodeShape;
}

export type AiRemoteAction =
    | "ai:get"
    | "ai:set"
    | "ai:invoke"
    | "ai:children"
    | "ai:elements"
    | "ai:highlight";

export interface IAiRemoteRequest {
    readonly action: AiRemoteAction;
    readonly path: string;
    readonly args?: readonly unknown[];
    readonly value?: unknown;
    readonly maxLength?: number;
    readonly timeoutMs?: number;
    readonly view?: string;
    readonly name?: string;
    readonly message?: string;
}

export type IAiRemoteResponse =
    | {
        readonly ok: true;
        readonly result?: unknown;
        readonly truncated?: boolean;
        readonly totalLength?: number;
        readonly shown?: number;
        readonly total?: number;
    }
    | {
        readonly ok: false;
        readonly error: string;
    };
