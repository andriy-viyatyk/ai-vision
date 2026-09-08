# Demo page

Run `npm run build` in the package root before opening `index.html`. The page imports the emitted
ESM files from `../../dist`, has no bundler, and makes no fetch requests, so it works directly from
the filesystem with `file://` as well as from a static server.

The page exposes a small task model through `window.__aiVision`, describes it, mounts a loopback
`createRemoteProxy`, and sends the call-console paths through `resolveCall`.
