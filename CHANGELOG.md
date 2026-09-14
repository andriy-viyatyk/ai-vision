# Changelog

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
