import { IAiChild, IAiMember, IAiVisionDescriptor } from "./types.js";
import { joinChildPath } from "./path-parser.js";

/**
 * Hint text for a node. Two parts, matching the descriptor's two halves:
 * the kind-level member list (deduped per session by the caller) and the instance-level children
 * list (always shown, because it is what exists right now).
 */

export interface IHint {
    kind: string;
    text: string;
}

export function formatChildren(path: string, children: readonly IAiChild[]): string {
    if (children.length === 0) return "";
    const lines = children.map(child => {
        const line = `  ${joinChildPath(path, child.segment)} — ${child.kind}: ${child.summary}`;
        return child.restricted ? `${line} [restricted: ${child.restricted}]` : line;
    });
    return `children (live):\n${lines.join("\n")}`;
}

function formatRelativeChildren(children: readonly IAiChild[]): string {
    if (children.length === 0) return "";
    const lines = children.map(child => {
        const line = `  ${child.segment} — ${child.kind}: ${child.summary}`;
        return child.restricted ? `${line} [restricted: ${child.restricted}]` : line;
    });
    return `children (relative to this object):\n${lines.join("\n")}`;
}

export function formatMember(member: IAiMember): string {
    const name = member.kind === "method" ? (member.signature ?? `${member.name}()`) : member.name;
    const flags: string[] = [];
    if (member.writable) flags.push("writable");
    if (member.caution) flags.push(`CAUTION: ${member.caution}`);
    const suffix = flags.length ? ` [${flags.join("; ")}]` : "";
    return `  ${name} — ${member.summary}${suffix}`;
}

export function formatMembers(members: readonly IAiMember[]): string {
    if (members.length === 0) return "";
    return `members:\n${members.map(formatMember).join("\n")}`;
}

/**
 * Build the hint returned alongside a result.
 * @param includeMembers false once the session has already seen this kind's member list.
 */
export async function buildHint(
    path: string,
    descriptor: IAiVisionDescriptor,
    includeMembers: boolean,
    relativeChildren = false,
): Promise<IHint> {
    const parts: string[] = [`${descriptor.kind} — ${descriptor.summary}`];
    const restricted = descriptor.restricted?.();
    if (restricted) parts.push(`restricted: ${restricted}`);
    const children = await descriptor.children?.() ?? [];
    const childrenText = relativeChildren
        ? formatRelativeChildren(children)
        : formatChildren(path, children);
    if (childrenText) parts.push(childrenText);
    if (path === "" && descriptor.overview) parts.push(descriptor.overview);
    if (includeMembers) {
        const membersText = formatMembers(descriptor.members);
        if (membersText) parts.push(membersText);
        if (!relativeChildren) {
            parts.push(`Details: call with path "${path ? `${path}.$help` : "$help"}".`);
        }
    }
    return { kind: descriptor.kind, text: parts.join("\n") };
}

/** Build the compact hint used when a forced resolver error has already emitted this kind's members. */
export async function buildErrorHint(
    path: string,
    descriptor: IAiVisionDescriptor,
    includeMembers: boolean,
    relativeChildren = false,
): Promise<IHint> {
    if (includeMembers) return buildHint(path, descriptor, true, relativeChildren);
    if (relativeChildren) {
        const childrenText = formatRelativeChildren(await descriptor.children?.() ?? []);
        return {
            kind: descriptor.kind,
            text: [
                `${descriptor.kind} — ${descriptor.summary}`,
                childrenText,
            ].filter(Boolean).join("\n"),
        };
    }
    return {
        kind: descriptor.kind,
        text: `${descriptor.kind} — ${descriptor.summary}\nDetails: call with path "${path ? `${path}.$help` : "$help"}".`,
    };
}

/**
 * A child in a `$describe` payload: the raw `IAiChild` plus the absolute path it resolves at, so a
 * consumer building a tree does not have to re-implement `joinChildPath`.
 */
export interface IAiDescriptionChild extends IAiChild {
    readonly path: string;
}

/**
 * The `$describe` payload — the same descriptor `$help` renders as prose, projected to data.
 *
 * For programmatic consumers (a tree view, a generated client, a test harness). Agents should keep
 * using `$help`: prose is the better artifact for them, and its wording is free to change, whereas
 * this shape is a contract.
 */
export interface IAiDescription {
    /** Where this node was resolved; "" at the root. */
    readonly path: string;
    readonly kind: string;
    readonly summary: string;
    readonly members: readonly IAiMember[];
    readonly children: readonly IAiDescriptionChild[];
    /** The descriptor's compact first-step map, when it declares one. */
    readonly overview?: string;
    /** Long-form help, already resolved when the descriptor supplies it as a function. */
    readonly help?: string;
    /** Canonical root-relative path, when the node is addressable. */
    readonly identity?: string;
    /** The node is described but nothing under it resolves — same rule as `$help`. */
    readonly restricted?: string;
}

/** The structured `$describe` rendering: the `$help` descriptor as data rather than prose. */
export async function buildDescription(path: string, descriptor: IAiVisionDescriptor): Promise<IAiDescription> {
    const help = typeof descriptor.help === "function" ? descriptor.help() : descriptor.help;
    const children = await descriptor.children?.() ?? [];
    const identity = descriptor.identity?.();
    const restricted = descriptor.restricted?.();
    return {
        path,
        kind: descriptor.kind,
        summary: descriptor.summary,
        members: descriptor.members,
        children: children.map(child => ({ ...child, path: joinChildPath(path, child.segment) })),
        ...(descriptor.overview ? { overview: descriptor.overview } : {}),
        ...(help ? { help: help.trim() } : {}),
        ...(identity ? { identity } : {}),
        ...(restricted ? { restricted } : {}),
    };
}

/** The full `$help` rendering: long-form help, then members, then live children. */
export async function buildHelp(path: string, descriptor: IAiVisionDescriptor): Promise<string> {
    const parts: string[] = [`${descriptor.kind} — ${descriptor.summary}`];
    if (descriptor.overview) parts.push(descriptor.overview);
    const help = typeof descriptor.help === "function" ? descriptor.help() : descriptor.help;
    if (help) parts.push(help.trim());
    const membersText = formatMembers(descriptor.members);
    if (membersText) parts.push(membersText);
    const childrenText = formatChildren(path, await descriptor.children?.() ?? []);
    if (childrenText) parts.push(childrenText);
    return parts.join("\n\n");
}


