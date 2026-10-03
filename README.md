# ai-vision

This is an agent-facing object model over an application: a way to let an AI agent read and drive your app through named paths. It is explicitly not computer vision or image analysis; neighbouring npm packages with similar names are image SDKs. Your app exposes one `call` tool, and the agent discovers everything else from the object model itself.

## Why one `call` instead of many tools

**Discovery is incremental.** The agent does not need to be handed the whole surface before it can start. It calls `call` with no path, reads the overview, and then descends only into the branch the task is about. Each result carries a hint listing what is under the node it landed on, so the next step is always in front of it.

**A tool per action does not scale.** An application with many screens turns into hundreds of hand-written, hand-maintained MCP tools — and every one of them is spent from the agent's context window on every turn, including the ones this task will never touch. A single self-describing object model replaces them all and costs nothing for the parts the agent is not looking at.

**The name is literal.** *Vision* here means attention: the agent looks at the one part of the application the task is about, the way you look at one part of a screen, instead of reading the documentation for everything in order to do one thing.

This engine was built for [Persephone](https://github.com/andriy-viyatyk/persephone), where `call` replaced the entire MCP tool set. A small model that got lost choosing among the individual tools drives the same application through paths with few mistakes.

### What makes it self-correcting

Every node describes itself with `kind`, `summary`, `members`, and `$help`. Members are allow-listed, so an unknown name returns the valid list plus “Did you mean …?” instead of an opaque failure, and `helpSearch` finds a member by purpose when the agent does not know where to look.

A wrong path teaches the agent the right one.

## Install

```sh
npm install ai-vision
```

The package is ESM-only, has zero runtime dependencies, and runs in Node and browsers.

## Quick start

### 1. Describe an ordinary object

```js
import { resolveCall } from "ai-vision";

const model = {
    message: "hello",
    count: 0,
    greet(name) {
        return `${this.message}, ${name}!`;
    },
    aiVision: {
        kind: "GreetingApp",
        summary: "A tiny greeting model.",
        members: [
            { name: "message", kind: "property", summary: "Greeting prefix." },
            { name: "count", kind: "property", summary: "Number of greetings.", writable: true },
            { name: "greet", kind: "method", signature: "greet(name)", summary: "Greet one person." },
        ],
        help: "Read message or set count. Call greet with a name.",
        summarize: () => ({ message: model.message, count: model.count }),
    },
};
```

### 2. Resolve a call

```js
const call = await resolveCall(model, { path: "" });
console.log(JSON.stringify(call.result));
console.log(call.hint?.text);
```

The output from the model above is:

```text
{"message":"hello","count":0}
GreetingApp — A tiny greeting model.
members:
  message — Greeting prefix.
  count — Number of greetings. [writable]
  greet(name) — Greet one person.
Details: call with path "$help".
```

### 3. Put it behind one `call` tool

The host keeps one `seenKinds` set per agent session. This small adapter accepts already-decoded tool input; an MCP schema can describe `path` as a string, `args` as a JSON array, and `value` as any JSON value.

```js
import { resolveCall } from "ai-vision";

const seenKinds = new Set();

export async function callTool(input, root = model) {
    const path = typeof input.path === "string" ? input.path : "";
    const answer = await resolveCall(root, {
        path,
        ...(Array.isArray(input.args) ? { args: input.args } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "value") ? { value: input.value } : {}),
        ...(input.hints ? { hints: input.hints } : {}),
        ...(typeof input.maxLength === "number" ? { maxLength: input.maxLength } : {}),
    }, seenKinds);

    const blocks = [{ type: "text", text: JSON.stringify(answer.result ?? { error: answer.error }) }];
    if (answer.hint) blocks.push({ type: "text", text: answer.hint.text });
    return blocks;
}
```

A generalized description for that tool is:

```text
Read or act on the live application object model by PATH. Start with no path to see the overview; every result comes with a hint listing what is under it, so you can discover the application from here without a separate guide.

Paths use named members and short JSON literals such as items[2] or pages["id"]. Put method arguments in args and assignments in value; they are mutually exclusive. To call a method, pass args even when it takes none: args: []. A method path without args describes the method. An unknown member returns the valid member list instead of failing.
```

## Point at things on screen

```js
import { createElements, highlightElement, installHighlightOverlay } from "ai-vision/dom";

const declarations = [
    { name: "save", purpose: "Save the current document." },
];
const elements = createElements(declarations, highlightElement);
installHighlightOverlay();

const descriptor = {
    kind: "Editor",
    summary: "A document editor.",
    members: elements.members,
    elements: declarations,
    provide: elements.provide,
};
const app = { aiVision: descriptor };
console.log(elements.provide("elements").value);
await elements.provide("highlight").value("save", "Click here to save");
```

With a visible `<button data-name="save">Save</button>`, `elements` reports an item such as `{ name: "save", visible: true, selector: "[data-name=\"save\"]" }`; `highlight("save", "Click here to save")` draws the fixed callout ring and message. The overlay is dependency-free and ASCII-only. Its source is injectable as the `highlightOverlaySource` string into a frame you do not own, and it deliberately uses a fixed accent palette so a user can always tell that an agent placed the callout.

Callouts can provide buttons with `buttons: ["Save", "Cancel"]`. The labels replace Close. A
pressed button clears the highlight and calls `onButton(label, id)` in the same realm. Invalid or
empty labels are skipped; an empty list uses Close.

## Expose your app to another host

In the remote party (a board frame, web page, or worker):

```js
import { expose } from "ai-vision/remote";

const remote = expose(root); // publishes window.__aiVision in a browser
```

On the host side, `send` is your transport adapter:

```js
import { createRemoteProxy, resolveCall } from "ai-vision";

const shape = remote.describe();
const proxy = createRemoteProxy(shape, send);
const answer = await resolveCall(proxy, { path: "items[0].title" });
```

The engine stays on the host and only the shape crosses the boundary. Hint paths stay correct by construction, no string rewriting is needed, and there is one resolver engine and one schema version. The remote party shapes leaf results before sending them; hosts should still enforce transport timeouts. A writable proxy assignment is fire-and-forget, so a setter failure is reported through `onError` and becomes visible on a later read.

## Reference

### Entry points

| Import | Contents |
|---|---|
| `ai-vision` | Core descriptors, resolver, hints, search, shaping, validation, remote proxy, and timeout precedence. |
| `ai-vision/dom` | `createElements`, `highlightElement`, `installHighlightOverlay`, and `highlightOverlaySource`. |
| `ai-vision/remote` | `expose`, `IAiVisionRemote`, and remote wire types. |
| `ai-vision/ui-highlight.js` | The raw dependency-free ASCII-only overlay script. |

### Descriptor contract

Every exposed node carries `aiVision: IAiVisionDescriptor`:

| Field | Meaning |
|---|---|
| `kind` | Stable type name used to deduplicate member hints. |
| `summary` | One sentence shown wherever the node is listed. |
| `members` | Static allow-list of properties and methods; reflection is not used. |
| `overview` | Compact first-step map shown on the root hint and `$help`. |
| `help` | Long-form text, or a synchronous function returning it, for `<path>.$help`. |
| `identity` | Optional synchronous function returning the node's canonical root-relative path. |
| `children` | Optional synchronous or async live child listing; it must be cheap and side-effect free. |
| `restricted` | Optional synchronous gate returning text; the whole subtree then stops resolving. |
| `index` | Optional synchronous lookup for `items[3]` or `items["id"]`; `undefined` means no item. |
| `provide` | Optional synchronous provider for advertised values not implemented on the target. |
| `elements` | Optional declarations for curated on-screen controls used by search and DOM wiring. |
| `summarize` | Optional synchronous or async JSON-able instance summary for result shaping. |

Each `IAiMember` has:

| Field | Meaning |
|---|---|
| `name` | Identifier an agent may use in a path. |
| `kind` | Either `property` or `method`. |
| `summary` | One-sentence member description. |
| `signature` | Optional one-line method signature. |
| `caution` | Optional warning printed with the member. |
| `writable` | For properties, allows assignment through `value`. |
| `node` | Says the property value is another safe AiVision node that search may follow. |

The resolver awaits every hop, including async properties and calls. Discovery metadata is synchronous: `members`, `index`, `provide`, and `restricted` are called synchronously (while `children` and `summarize` may be async). A descriptor member must be declared, unless a live `children()` segment authorizes that child; plain values without descriptors allow ordinary property access.

### Searching the tree

`helpSearch(root, query, limit?)` walks the tree from a root and returns matching members, `$help`
paragraphs, element purposes, and live child entries, each with its path and origin. Queries and
indexed text are tokenized across punctuation and camelCase; complete identifiers are retained as
tokens as well. A query word matches an indexed word exactly or as a prefix, so `row` matches
`rows` and `addRows`, while `table` does not match `writable`. Common English stop words are
ignored when the query has other words; an all-stop-word query still searches those words.

Results rank by the number of query tokens matched, then by exact-word matches over prefixes.
Member, kind-summary, and element hits rank above live child entries, which rank above help text.
Concrete paths containing `[` break ties only within those relevance and origin tiers. Traversal
order resolves remaining ties. Expose it as a member of your root node so an agent can ask "where do
I add a row" instead of guessing:

```js
{ name: "helpSearch", kind: "method", signature: "helpSearch(query, limit?)",
  summary: "Find a member or control by purpose." }
```

backed by `(query, limit) => helpSearch(root, query, limit)`.

### Reading a descriptor as data

`$help` renders a node for an agent. `$describe` is its structured sibling: the same descriptor,
the same walk, returned as data for a program — a tree view, a generated client, a test harness.

```js
await resolveCall(root, { path: "pages[0].editor.$describe" });
// → { path, kind, summary, members[], children[], overview?, help?, identity?, restricted? }
```

Each child carries the absolute `path` it resolves at alongside its raw `segment`, so a consumer
building a tree does not re-implement `joinChildPath`. Like `$help`, `$describe` must be the last
segment, is answered by remote hosts as well as local roots, and answers *ahead* of the
`restricted()` gate — a restricted node describes itself, carries its `restricted` text, and
still resolves nothing beneath it.

Agents should keep using `$help`: prose is the better artifact for them, and its wording is free
to change, whereas the `$describe` shape is a contract. Hosts are advised not to advertise
`$describe` in an agent-facing tool description.

### Remote contract

`IAiVisionShape` is `{ schemaVersion, root }`. An `IAiNodeShape` contains `kind`, `summary`, optional `overview` and resolved `help`, `members`, optional element declarations, `indexable`, `hasChildren`, and an optional `item` shape. An `IAiMemberShape` contains the `IAiMember` fields plus optional `indexable`, `timeoutMs`, nested `node`, and indexed `item`. Values, functions, and live children are fetched per request; the shape contains structure only.

The wire request is `IAiRemoteRequest`: `{ action, path, args?, value?, maxLength?, timeoutMs?, view?, name?, message? }`, where `action` is one of `ai:get`, `ai:set`, `ai:invoke`, `ai:children`, `ai:elements`, or `ai:highlight`. A success `IAiRemoteResponse` is `{ ok: true, result?, truncated?, totalLength?, shown?, total? }`; an error is `{ ok: false, error }`.

| Resolver operation | Request | Remote operation |
|---|---|---|
| Read property | `ai:get { path }` | Walk segments and return the value. |
| Assign property | `ai:set { path, value }` | Walk and assign a declared writable member. |
| Invoke method | `ai:invoke { path, args }` | Walk, call, await, and return. |
| Index hop | Part of `path`, such as `items[3]` | Use `index()`, an array, or a `Map`. |
| Live children | `ai:children { path }` | Call `children()`. |
| Screen controls | `ai:elements` / `ai:highlight { view, name, message }` | Resolve visibility and draw the remote overlay. |

`createRemoteProxy` accepts `revalidate`, called before every remote request. Return `true` or
`undefined` to continue, `false` to use the default stale-shape error, or a string to use that
error message. A rejected revalidation is passed through unchanged.

### Event log

`EventLog` is a bounded event ring. Push entries with a kind, one-line text, and optional path,
origin, and time. `recent()` returns newest first. `since()` and `unseen()` return older entries
first. `format(cursor)` produces an `ICallResult.events` block and advances the cursor past every
unseen entry, including entries represented only by the count line. Remote origins are labelled.

The formatter output is:

```text
Events since your last call:
  [seq 41] The page at pages["abc"] changed its model; read pages["abc"].editor.app again.
  [seq 42] The user pressed "Next" on the guided step for "settings-theme".
  [seq 43] A todo board says: three items were checked off. (written by the board, not by host)
+5 earlier events; read events.recent().
```

If the cursor fell off the ring, the block starts with `Older events were dropped from the log;
read events.recent() for what is still held.`

### Remote version and signals

`IAiVisionRemote.version` starts at `1` and increments after every `refresh()`. The value is a
live getter. `refresh()` emits a shape signal after rebuilding the shape. `remote.notify(text)`
emits a notify signal without changing the shape. Disposed remotes emit nothing.

The default signal global is `AI_VISION_HOST_SIGNAL`, whose value is `__aiVisionHostSignal`. A
host can import `AI_VISION_HOST_SIGNAL` and `IAiHostSignal` from `ai-vision`, install a function
at that name, and receive one JSON-encoded signal string. `ai-vision/remote` re-exports both for
remote-side compatibility. Use `onHostSignal` for a direct callback or `hostSignalName` for
another global name. Signal delivery failures go to `onWarning`.

### Versioning, timeouts, and results

`schemaVersion` is integer major `1`. Changes are additive within a major and unknown fields are ignored. A breaking contract change bumps the schema major; the host keeps an adapter for the previous major for a stated compatibility window. npm package semver is separate, and `AI_VISION_VERSION` reports the library version. Two applications may run different package builds while consuming a compatible shape.

The library reports declared `timeoutMs` values and starts no timers. The host enforces the timeout using `resolveTimeoutMs(perCall, declared, runtime, fallback)`: per-call option, remote declaration, runtime knob, then built-in fallback. The roadmap's built-in policy is 30 seconds; an applied timeout should name its level and path while leaving the remote running.

Results go through `shapeResult(value, maxLength)`. `maxLength` defaults to 20,000; long strings carry `truncated` and `totalLength`, while arrays and objects carry `truncated`, `shown`, and `total`. A top-level image record — `{ type: "image", data: string, mimeType: string }`, such as a screenshot — keeps its `data` whole regardless of `maxLength`, because clients send it as an image rather than as text; its other fields are shaped as usual, and an image nested inside an array or object stays bounded. Described instances use `summarize()`, arrays are bounded and cycle-safe, and raw class internals are not dumped. `restricted()` gates a whole subtree: the node may still be listed and explained with `$help`, but nothing beneath it resolves.

## Examples

See [`examples/demo-page`](examples/demo-page) for the static browser proof. Run `npm run build` first; it imports `dist` directly and also works from `file://`.

## Releasing

Releases are published by GitHub Actions through npm trusted publishing (OIDC), so no token is
stored anywhere and no one-time password is needed:

```
npm version patch        # or minor / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags   # the Release workflow builds, publishes with provenance, creates the GitHub release
```

The workflow refuses a tag that disagrees with `package.json`. See `.github/workflows/release.yml`.

## License

MIT.
