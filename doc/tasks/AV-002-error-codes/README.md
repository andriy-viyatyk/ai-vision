# AV-002: Keep a thrown error's code in the call envelope

## Goal

When a member throws an error that carries a string `code`, the resolver's error envelope
(`ICallResult`) and the remote error response keep it as an optional `code` field, so a host can
show it to the agent in one form for every part of its tree. Errors without a code are unchanged.

## Background

- [src/core/resolver.ts](../../../src/core/resolver.ts): `resolveCall` catches a thrown member
  (getter, method, awaited promise, index hop) and a failed assignment, and builds the envelope
  through `errorAt(...)` with `errMessage(error)` only. `ICallResult.error` is a string, so the
  code is lost before the host sees the result.
- [src/core/errors.ts](../../../src/core/errors.ts): `errMessage` is the one message helper.
- [src/remote/expose.ts](../../../src/remote/expose.ts) answers a failed request with
  `{ ok: false, error }`; [src/core/remote-proxy.ts](../../../src/core/remote-proxy.ts)
  `sendRequest` turns it into `new Error(response.error)`, so a remote model's coded error also
  loses its code before it reaches the host resolver.
- Reported by the consumer (Persephone): its capability namespace worked around this by appending
  `[code: <code>]` to messages; every other namespace lost codes.

## Implementation plan

- [x] `errors.ts`: add `errCode(e)` — the non-empty string `code` of an error-like value, else
  `undefined`. Export it from `src/core/index.ts` next to `errMessage`.
- [x] `resolver.ts`: add optional `code?: string` to `ICallResult` (set on errors only).
  `ErrorAtOptions` gets `code`; the thrown-member catch and the failed-assignment catch pass
  `errCode(error)`. `errorAt` spreads `code` only when present, on both return branches.
- [x] `remote-types.ts`: error `IAiRemoteResponse` gets optional `code?: string`.
  `expose.ts` adds it from `errCode(error)`; `remote-proxy.ts` throws an `Error` with that `code`
  attached (own enumerable property), so the host resolver picks it up.
- [x] README (new "Errors" reference subsection, remote contract line) and CHANGELOG `1.4.0`.

## Concerns / Open questions

- Only string codes are kept (Node's `ENOENT`, app codes like `rejected`). Numeric `code` values
  are ignored, so nothing surprising lands in the envelope. Decision: strings only.
- Resolver-built errors (unknown member, not writable, path syntax) carry no `code`; they are
  self-correcting messages, not thrown errors. Decision: unchanged.
- The message is not altered; formatting the code for the agent is the host's job.

## Acceptance criteria

- [x] A member throwing `Object.assign(new Error("m"), { code: "x" })` yields `{ error: "m", code: "x" }`.
- [x] A member throwing a plain `Error`, or a string, yields exactly the 1.3.0 envelope (no `code` key).
- [x] A coded error thrown inside an `expose()`d model keeps its code through `createRemoteProxy`.
- [x] Additive only: minor version bump.

## Files changed

| File | Change |
|---|---|
| `src/core/errors.ts` | `errCode()` |
| `src/core/index.ts` | export `errCode` |
| `src/core/resolver.ts` | `ICallResult.code`; thrown and assignment errors keep the code |
| `src/core/remote-types.ts` | error response `code?` |
| `src/remote/expose.ts` | send `code` |
| `src/core/remote-proxy.ts` | rethrow with `code` |
| `README.md`, `CHANGELOG.md` | docs, 1.4.0 |
