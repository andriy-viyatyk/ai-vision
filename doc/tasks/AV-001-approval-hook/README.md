# AV-001: Approval hook — per-path approval for agent calls

**Status:** Planned — not started. Recorded on 2026-10-10 for a later look; no implementation yet.

## Goal

Give the ai-vision library an async **approval hook**: before the resolver reads, writes or calls
something on behalf of an agent, it asks the host app, and the app decides — allow, deny, or ask
the user. This brings back the per-tool approval that MCP clients offer for flat tools, at a finer
grain: per path instead of per tool. What counts as critical, and which branches are trusted,
stays the app's decision.

## Background

### Why

With flat MCP tools, a client approves each tool by name and can auto-approve tools annotated
`readOnlyHint`. ai-vision exposes one `call` tool, so the client sees one tool, and that
granularity is lost — the main fair criticism of single-tool designs (the site page
[One tool, not hundreds](https://andriy-viyatyk.github.io/ai-vision/mcp-at-scale/), "The
trade-offs"; lazy-mcp documents the same gap). Today ai-vision only *informs*: a member's `caution`
text is printed in the hint. Enforcement is ad hoc, inside individual Persephone members (board
trust dialog, tool registration consent).

The resolver sees more than any MCP client can: the full path, the node's kind, the member, whether
it is a read, a write or a call, the arguments, and the member's `caution`. So the decision can be
much better than "allow tool `call`?".

### Where it fits in ai-vision (`C:\projects\ai-vision`)

- [`src/core/resolver.ts`](../../../src/core/resolver.ts) — `resolveCall(root, request,
  seenKinds)` is the single chokepoint. The walk loop already has the three effect points:
  - **write**: the `isLast && hasValue` branch, just before `(current)[name] = valueToAssign`;
  - **call**: `value.apply(target, args)` in two places (explicit `()` segment, and a method named
    as the last segment with `request.args`). Intermediate calls (`pages.openFile(...).editor`)
    go through the same code;
  - **read**: `provided ? provided.value : target[name]` — a getter read on every hop.
  It also has a precedent for a gate: `descriptor.restricted()` stops the walk with a message
  before anything under the node resolves.
- [`src/core/types.ts`](../../../src/core/types.ts) — `IAiMember` has `caution?`,
  `writable?`, `node?` (`node` already means "reading it is safe"). `IAiVisionDescriptor.identity()`
  gives a canonical, addressable path for a node.
- [`src/core/remote-proxy.ts`](../../../src/core/remote-proxy.ts) — boards and web pages
  are host-side proxy nodes (`createRemoteProxy`) walked by the host resolver, so a host hook sees
  their members too. Verify how a proxied method call is forwarded before relying on this.
- `$help`, `$describe` and `helpSearch` are metadata; they must never be gated.

### Where it fits in Persephone (the main consumer, `C:\projects\persephone`)

- Persephone `src/renderer/scripting/ai-vision/call.ts` —
  `aiCall` is the MCP `call` entry; `resolveAiCall` builds the `AiRoot` and calls `resolveCall`.
- Persephone `src/renderer/scripting/api-wrapper/AppWrapper.ts`
  (line ~126) — **scripts** also resolve paths through `resolveCall` (`app.call`). A user's own
  script must not be gated like an agent, so the hook is passed per call site, not set globally.
- Persephone `src/main/mcp/tools/call-tools.ts` (line ~221) — the
  main-process root (`main.*`) resolves separately; it needs the same hook.
- Persephone `src/renderer/scripting/ai-vision/attention.ts`
  — `resolveWithAttention` already returns `{ pending: true, attention }` when a call opens a dialog
  and the user has not answered yet. An approval dialog is exactly that case, so a slow approval
  needs no new mechanism on the Persephone side.

## Implementation plan

### Part 1 — ai-vision library (minor version)

1. **Types** (`src/core/resolver.ts` or a new `src/core/approval.ts`, exported from `index.ts`):
   ```ts
   export type AiAction = "read" | "write" | "call";

   export interface IAiApprovalRequest {
       action: AiAction;
       /** Path as walked, e.g. `pages[0].editor.setSearch`. */
       path: string;
       /** Canonical path from the nearest `identity()`, e.g. `pages["<id>"].editor.setSearch`,
        *  when one exists — stable for "trust this branch" decisions; positions are not. */
       canonicalPath?: string;
       kind?: string;           // descriptor kind of the node that owns the member
       member?: IAiMember;      // includes caution / writable
       args?: readonly unknown[];
       value?: unknown;
   }

   export type AiApprovalDecision = true | { allow: false; reason: string };

   export type AiApprovalHook = (request: IAiApprovalRequest) =>
       AiApprovalDecision | Promise<AiApprovalDecision>;

   export interface IResolveOptions {
       approve?: AiApprovalHook;
   }
   ```
2. **`resolveCall(root, request, seenKinds, options?)`** — new optional 4th parameter; no change for
   existing callers. Call `options.approve` at the three effect points, after the member check
   (so unknown members still get "Did you mean") and before the effect. For the call case:
   ```ts
   // before
   const args = isLast && request.args ? request.args : segment.args;
   value = (value as (...a: unknown[]) => unknown).apply(target, args);

   // after
   const args = isLast && request.args ? request.args : segment.args;
   const denied = await askApproval(options, { action: "call", path: formatPath([...walked, segment]),
       canonicalPath: canonicalOf(current, name), kind: descriptor?.kind, member, args });
   if (denied) return denied;   // { path, error: "Not approved: …", resolvedUpTo, denied: true }
   value = (value as (...a: unknown[]) => unknown).apply(target, args);
   ```
   The write branch and the `caution` read get the same `askApproval` call before their effect.
3. **What triggers the hook** (keep the per-hop cost near zero):
   - every **write** and every **call** (including intermediate calls);
   - a **read** only of a member with `caution` (a getter with side effects, e.g. `page.grouped`).
     Plain reads and `node: true` members are not gated. Decide in this task whether the host may
     opt in to all reads (e.g. `approveReads: "caution" | "all"`) for sensitive branches such as
     file contents; default `"caution"`.
   - never `$help`, `$describe`, `helpSearch`, hints, or member lists.
4. **Denied**: return `{ path, error: "Not approved: <reason>", resolvedUpTo, denied: true }` — a new
   `denied?: boolean` on `ICallResult`, so an agent can tell a user's "no" from a bug and does not
   retry in a loop. No hint needed beyond the normal one.
5. **Optional helper** (decide during investigation; may be a follow-up): a small policy builder for
   the common cases, so each host doesn't write the same matcher:
   ```ts
   createApprovalPolicy({
       rules: [
           { path: "fs.**", action: ["write", "call"], decide: "ask" },
           { path: "pages[*].editor.app.**", decide: "allow" },
       ],
       ask: (request) => showDialog(...),          // host-supplied
       remember: "session",                          // "always allow this branch" answers
   })
   ```
   Matching should use `canonicalPath` when present.
6. **README.md**: a "Approval" section (what is gated, the request shape, deny result, examples).
   **CHANGELOG.md**: new minor version. Release per ai-vision's `CLAUDE.md` (tag → GitHub Actions).

### Part 2 — Persephone integration (after the library release)

This part is done in the Persephone repository; create a Persephone task for it (its own task
workflow, `doc/active-work.md` there) when Part 1 is released.

7. `npm install ai-vision@^x.y.z --prefer-online`.
8. Pass `approve` only on the **agent** paths: `aiCall` (renderer MCP `call`) and the main-process
   `call-tools.ts` root. Not on `AppWrapper` (`app.call` from user scripts).
9. Persephone's policy (a new module, e.g. `src/renderer/scripting/ai-vision/approval.ts`):
   - allow reads and the agent's own output channel (`pages.logView.*`) silently;
   - ask for members whose `caution` marks real risk — `fs` writes, `proc`, `shell`,
     `script.execute`, `main.script.execute`, destructive page actions — via a Persephone dialog
     with **Allow once / Allow for this session / Deny**;
   - "Allow for this session" remembers the canonical branch (e.g. `fs.write*`) per MCP session;
   - members that already show their own consent dialog (board trust, tool registration) are not
     asked twice;
   - a setting to turn approvals off (trusted local setups) and maybe a per-branch "always allow"
     list editable in Settings.
   While the dialog is open the call returns `pending` + `attention` through the existing
   `resolveWithAttention`, so long approvals don't hit the MCP timeout.
10. Docs: `/document` (scripting/MCP architecture docs) and `/userdoc` (the MCP guide: what gets
    asked and how to change it).

## Concerns / Open questions

- **Which reads to gate.** Gating every hop would be noisy and slow; gating none misses sensitive
  reads (file contents, clipboard history, page content of a private page). Proposed default:
  only `caution` getters, with a host opt-in. Revisit with real cases.
- **Stable paths.** `pages[0]` is a position and changes; "trust this branch" must key on
  `identity()` where it exists. Nodes without `identity()` fall back to the walked path, which may
  be too broad or too narrow.
- **Remote models** (boards, web pages, site extensions): does the host see each proxied member
  call individually, or one forwarded request? If forwarded as a whole, the hook needs the full
  remote path from the proxy. Also: should a board's own model be trusted by default once the user
  trusted the board?
- **`caution` is free text.** A policy matching on it is fragile. Consider a structured field on
  `IAiMember` (e.g. `effect?: "read" | "write" | "destructive" | "external"`) alongside `caution`,
  so hosts can decide by effect, like MCP's `readOnlyHint` / `destructiveHint`.
- **Approval fatigue.** Too many prompts and the user clicks Allow on everything. The session
  memory and the branch rules exist for this; the Persephone defaults should prompt rarely.
- **Who is calling.** The hook must only apply to agent calls. Persephone has three resolve sites
  (renderer MCP, main MCP, `app.call` in scripts); only the first two get it.
- **Not a sandbox.** Approval guards the `call` tool. An agent that may run `script.execute`
  (once approved) can do anything a script can; the policy should treat `script.execute` as the
  highest-risk member.

## Acceptance criteria

- ai-vision exports the approval types and `resolveCall` accepts `options.approve`; existing callers
  behave exactly as before.
- With a hook: writes and calls (including intermediate calls) and `caution` reads reach it with the
  documented request; `$help`, `$describe`, `helpSearch` and plain reads do not.
- A denied action returns `denied: true` with the reason and does not run the effect.
- An async hook that waits for a user works; in Persephone, the call returns `pending` + `attention`
  while the dialog is open.
- Persephone gates only agent calls; user scripts are unaffected.
- README/CHANGELOG (ai-vision) and Persephone docs/user guide describe the behavior.

## Files changed

| File | Change |
|---|---|
| `src/core/resolver.ts` | `IResolveOptions` parameter; `askApproval` at the write, call and `caution`-read points; `denied` on `ICallResult` |
| `src/core/approval.ts` (new) | Approval types; optional `createApprovalPolicy` helper |
| `src/core/index.ts` | Export the approval types (and helper) |
| `src/core/types.ts` | Only if the structured `effect` field on `IAiMember` is adopted |
| `README.md`, `CHANGELOG.md` | "Approval" section; minor version entry |
| `persephone/package.json`, `package-lock.json` | Bump `ai-vision` |
| `persephone/src/renderer/scripting/ai-vision/approval.ts` (new) | Persephone policy and approval dialog |
| `persephone/src/renderer/scripting/ai-vision/call.ts` | Pass `approve` from `aiCall` / `resolveAiCall` for agent calls |
| `persephone/src/main/mcp/tools/call-tools.ts` | Pass `approve` for the main-process root |
| `persephone/doc/…`, `persephone/assets/guides/…` | Developer docs and the MCP user guide |

**No changes needed:** `src/core/path-parser.ts`, `hint.ts`, `help-search.ts`,
`member-suggestion.ts`, `result-shaper.ts`; `src/dom/*`; Persephone's
`src/renderer/scripting/api-wrapper/AppWrapper.ts` (user scripts stay ungated) and
`src/renderer/scripting/ai-vision/attention.ts` (its `pending` + `attention` already covers an open
approval dialog).
