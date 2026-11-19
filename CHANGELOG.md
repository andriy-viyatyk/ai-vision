# Changelog

## 1.4.0

- A failed call keeps the thrown error's own string `code` as `ICallResult.code` (thrown
  members, rejected promises, index hops and failed assignments). Errors without a string code,
  and the resolver's own path errors, are unchanged: no `code` key.
- The remote error response `{ ok: false, error, code? }` carries the code too, and
  `createRemoteProxy` rethrows it with that `code`, so a code thrown inside an `expose()`d model
  reaches the host's envelope.
- Added `errCode(error)`, exported next to `errMessage(error)`.

## 1.3.0

- `helpSearch` tokenizes punctuation and camelCase while retaining complete identifiers, supports
  exact and prefix word matching, and ignores common English stop words when substantive terms
  remain.
- Search results rank by token coverage, exact-word matches, and hit origin; concrete instance
  paths break ties within those tiers.

## 1.2.1

- `shapeResult` no longer truncates a top-level image record (`{ type: "image", data, mimeType }`):
  its `data` is returned whole regardless of `maxLength`, so a screenshot reaches the client as a
  valid image. Other fields are still shaped; images nested in arrays or objects stay bounded.

## 1.2.0

- Added the `$describe` terminal path segment: the structured sibling of `$help`, returning a
  node's descriptor as data (`IAiDescription`) for programmatic consumers instead of prose.
  Answered ahead of the `restricted()` gate, exactly like `$help`, and carrying the `restricted`
  text in its payload.
- `$describe` is answered by remote hosts (`expose`) as well as local roots, so a remote model is
  browsable by the same code.
- Remote models may no longer declare a member named `$describe` (it was already true of `$help`).

## 1.1.0

- Added the bounded event log and `ICallResult.events` block type.
- Added lazy remote-shape revalidation for `createRemoteProxy`.
- Added remote versioning, host signals, and `notify()`.
- Added callout buttons and `onButton` callbacks.

## 1.0.0

- Initial release.
