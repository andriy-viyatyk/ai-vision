import { joinChildPath, parsePath } from "./path-parser.js";
import { formatMember } from "./hint.js";
import { getAiVision } from "./types.js";
import type { IAiVisionDescriptor } from "./types.js";

/**
 * Full-text search over the descriptor graph.
 *
 * Walks from the root through `children()` and through properties a descriptor marked `node: true`,
 * so the walk is side-effect free by construction: it visits only what a node declared safe.
 * Results are ranked by query coverage, exact-word matches, hit origin, then concrete instance path.
 */

export type IHelpSearchOrigin = "member" | "kind-summary" | "element" | "help-text" | "child-entry";

export interface IHelpSearchHit {
    path: string;
    kind: string;
    matchedLine: string;
    /** The descriptor data that produced this result. */
    origin?: IHelpSearchOrigin;
}

interface SearchCandidate {
    hit: IHelpSearchHit;
    matchedTokens: number;
    exactTokens: number;
    traversalOrder: number;
}

interface MatchScore {
    matchedTokens: number;
    exactTokens: number;
}

const MAX_NODES = 300;
const MAX_DEPTH = 5;

const STOP_WORDS = new Set((
    "a about above after again against all am an and any are as at be because been before " +
    "being below between both but by can could did do does doing down during each few for " +
    "from further had has have having he her here hers herself him himself his how i if in " +
    "into is it its itself me more most my myself no nor not of off on once only or other " +
    "our ours ourselves out over own same she should so some such than that the their theirs " +
    "them themselves then there these they this those through to too under until up very " +
    "was we were what when where which while who whom why will with would you your yours " +
    "yourself yourselves"
).split(/\s+/));

export async function helpSearch(root: unknown, query: string, limit = 20): Promise<IHelpSearchHit[]> {
    const allQueryTokens = tokenize(query);
    if (allQueryTokens.length === 0) return [];
    const substantiveTokens = allQueryTokens.filter(token => !STOP_WORDS.has(token));
    // Keep short all-stop-word searches useful (for example, searching for "to").
    const queryTokens = substantiveTokens.length > 0 ? substantiveTokens : allQueryTokens;
    const candidates: SearchCandidate[] = [];
    const seenKinds = new Set<string>();
    const queue: Array<{ node: unknown; path: string; depth: number }> = [{ node: root, path: "", depth: 0 }];
    let visited = 0;
    let traversalOrder = 0;

    while (queue.length && visited < MAX_NODES) {
        const { node, path, depth } = queue.shift()!;
        const descriptor = getAiVision(node);
        if (!descriptor) continue;
        visited++;

        // Kind-level lines only once per kind - a member match on Page reads the same for every page.
        if (!seenKinds.has(descriptor.kind)) {
            seenKinds.add(descriptor.kind);
            collectKindHits(path, descriptor, queryTokens, candidates, () => traversalOrder++);
        }

        if (depth >= MAX_DEPTH || descriptor.restricted?.()) continue;
        for (const member of descriptor.members) {
            // `node: true` is the author's statement that *reading* this property is safe; a
            // `caution` on it describes what its members do (fs writes), not the read itself.
            if (member.kind !== "property" || member.node !== true) continue;
            const childNode = await stepTo(node, `.${member.name}`);
            if (getAiVision(childNode)) {
                queue.push({ node: childNode, path: joinChildPath(path, `.${member.name}`), depth: depth + 1 });
            }
        }
        for (const child of await descriptor.children?.() ?? []) {
            const childPath = joinChildPath(path, child.segment);
            const childLine = `${childPath} - ${child.kind}: ${child.summary}`;
            addCandidate(childLine, queryTokens, {
                path: childPath,
                kind: child.kind,
                matchedLine: childLine,
                origin: "child-entry",
            }, candidates, () => traversalOrder++);
            if (child.restricted) continue;
            const childNode = await stepTo(node, child.segment);
            if (childNode !== undefined) queue.push({ node: childNode, path: childPath, depth: depth + 1 });
        }
    }

    candidates.sort(compareCandidates);
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, limit) : 20;
    return dedupe(candidates).slice(0, boundedLimit).map(candidate => candidate.hit);
}

function collectKindHits(
    path: string,
    descriptor: IAiVisionDescriptor,
    queryTokens: string[],
    candidates: SearchCandidate[],
    nextOrder: () => number,
): void {
    const nodeLine = `${descriptor.kind} - ${descriptor.summary}`;
    addCandidate(nodeLine, queryTokens, {
        path: path || "(root)", kind: descriptor.kind, matchedLine: nodeLine, origin: "kind-summary",
    }, candidates, nextOrder);

    for (const member of descriptor.members) {
        const line = formatMember(member).trim();
        addCandidate(`${member.name} ${line}`, queryTokens, {
            path: joinChildPath(path, member.kind === "method" ? `${member.name}()` : member.name),
            kind: descriptor.kind,
            matchedLine: line,
            origin: "member",
        }, candidates, nextOrder);
    }

    // A request like "where do I change the language" is about a control on screen, not about the
    // property that sets it. Without this, `helpSearch` answers only `page.language` and the agent
    // never finds the button it was asked to point at.
    for (const element of descriptor.elements ?? []) {
        const matchedText = `${element.name} ${element.purpose}${element.where !== undefined ? ` ${element.where}` : ""}`;
        const line = element.where === undefined
            ? `element "${element.name}" - ${element.purpose}`
            : `element "${element.name}" - ${element.purpose}; where: ${element.where}`;
        addCandidate(matchedText, queryTokens, {
            path: joinChildPath(path, "elements"),
            kind: descriptor.kind,
            matchedLine: `${line} Show it to the user with ${joinChildPath(path, `highlight("${element.name}")`)}.`,
            origin: "element",
        }, candidates, nextOrder);
    }

    const help = typeof descriptor.help === "function" ? descriptor.help() : descriptor.help;
    if (help) {
        for (const line of help.split("\n")) {
            if (!line.trim()) continue;
            addCandidate(line, queryTokens, {
                path: path ? `${path}.$help` : "$help",
                kind: descriptor.kind,
                matchedLine: line.trim(),
                origin: "help-text",
            }, candidates, nextOrder);
        }
    }
}

function addCandidate(
    searchableText: string,
    queryTokens: string[],
    hit: IHelpSearchHit,
    candidates: SearchCandidate[],
    nextOrder: () => number,
): void {
    const score = scoreMatch(searchableText, queryTokens);
    if (!score) return;
    candidates.push({ hit, ...score, traversalOrder: nextOrder() });
}

function scoreMatch(text: string, queryTokens: string[]): MatchScore | undefined {
    const indexedTokens = new Set(tokenize(text));
    let matchedTokens = 0;
    let exactTokens = 0;
    for (const queryToken of queryTokens) {
        const matches = [...indexedTokens].filter(indexedToken => indexedToken.startsWith(queryToken));
        if (matches.length === 0) continue;
        matchedTokens++;
        if (matches.includes(queryToken)) exactTokens++;
    }
    return matchedTokens > 0 ? { matchedTokens, exactTokens } : undefined;
}

/** Split punctuation and camelCase, retaining each complete identifier alongside its words. */
function tokenize(text: string): string[] {
    const tokens = new Set<string>();
    for (const identifier of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
        const lowerIdentifier = identifier.toLowerCase();
        tokens.add(lowerIdentifier);
        const words = identifier
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
            .split(/\s+/);
        for (const word of words) tokens.add(word.toLowerCase());
    }
    return [...tokens];
}

function compareCandidates(a: SearchCandidate, b: SearchCandidate): number {
    // Coverage is the primary relevance tier; exact word matches break ties above prefixes.
    return b.matchedTokens - a.matchedTokens
        || b.exactTokens - a.exactTokens
        || originRank(b.hit.origin) - originRank(a.hit.origin)
        || Number(b.hit.path.includes("[")) - Number(a.hit.path.includes("["))
        || a.traversalOrder - b.traversalOrder;
}

function originRank(origin: IHelpSearchOrigin | undefined): number {
    switch (origin) {
        case "member":
        case "kind-summary":
        case "element":
            return 2;
        case "child-entry":
            return 1;
        case "help-text":
        default:
            return 0;
    }
}

/** Follow one child segment from a node - an index or a single member/call. */
async function stepTo(node: unknown, segment: string): Promise<unknown> {
    try {
        const segments = parsePath(segment.startsWith(".") ? segment.slice(1) : `x${segment}`);
        let current: unknown = node;
        for (const step of segments) {
            const descriptor = getAiVision(current);
            if (step.type === "index") {
                current = descriptor?.index ? descriptor.index(step.key) : (current as Record<string, unknown>)?.[String(step.key)];
            } else if (step.type === "member") {
                if (step.name === "x" && segment.startsWith("[")) continue; // the synthetic prefix
                // Match the resolver: descriptor-provided values take precedence over plain properties.
                const provided = getAiVision(current)?.provide?.(step.name);
                current = provided ? provided.value : (current as Record<string, unknown>)?.[step.name];
            } else if (step.type === "call") {
                // Match the resolver here too, so remote proxy methods are provide-backed.
                const provided = getAiVision(current)?.provide?.(step.name);
                const fn = provided ? provided.value : (current as Record<string, unknown>)?.[step.name];
                if (typeof fn !== "function") return undefined;
                current = (fn as (...a: unknown[]) => unknown).apply(current, step.args);
            } else {
                return undefined;
            }
            current = await current;
            if (current === undefined || current === null) return undefined;
        }
        return current;
    } catch {
        return undefined;
    }
}

function dedupe(candidates: SearchCandidate[]): SearchCandidate[] {
    const seen = new Set<string>();
    return candidates.filter(candidate => {
        const { path, matchedLine } = candidate.hit;
        const key = `${path}|${matchedLine}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
