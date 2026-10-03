# ai-vision

An agent-facing object model over an application: the app exposes one `call` tool, and an agent
discovers and drives everything through named paths (`pages[0].editor.addRows`), self-describing
nodes (`kind`, `summary`, `members`, `$help`), hints, and `helpSearch`. It is **not** computer
vision. [README.md](README.md) is the full user-facing reference.

The main consumer is [Persephone](https://github.com/andriy-viyatyk/persephone)
(`C:\projects\persephone`), where `call` replaced the whole MCP tool set. Boards and web pages
inside Persephone use the `remote` and `dom` entry points to publish their own models.

## Where everything is

| Path | What |
|---|---|
| `src/core/` | Package root export (`ai-vision`): path parser, resolver (`resolveCall`), result shaping (`maxLength`, image records), hints, `helpSearch`, argument validation, events, remote proxy and types |
| `src/dom/` | `ai-vision/dom`: UI elements and highlight. `highlight-source.generated.ts` is **generated** by `scripts/generate-highlight-source.mjs` from `ui-highlight.js` — edit the source, not the generated file |
| `src/remote/` | `ai-vision/remote`: `expose()` — publish a model from another context (board iframe, web page) |
| `scripts/` | Build helpers: highlight-source generation, asset copy, clean |
| `examples/demo-page/` | A standalone demo page |
| `.github/workflows/release.yml` | Publishes to npm on a version tag (see below) |
| `dist/` | Build output — gitignored, never committed |

## Commands

```sh
npm run build    # generate highlight source + tsc + copy assets → dist/
npm run clean
```

There is no test suite and none should be added (the user's rule across projects). Sanity-check a
change with a throwaway `node -e "import('./dist/core/index.js').then(...)"` against `dist/`, then
verify in the consumer (Persephone) through its live MCP.

## Releasing — automatic, do NOT `npm publish` by hand

Publishing is done by GitHub Actions when a `v*` tag is pushed. There is **no npm token** anywhere:
the workflow authenticates with npm **trusted publishing (OIDC)** and adds a provenance
attestation, then creates the GitHub release. No `npm login` is needed, and a manual
`npm publish` is the wrong path.

1. Commit the change. Update [CHANGELOG.md](CHANGELOG.md) (new `## x.y.z` section at the top) and
   [README.md](README.md) if behavior or API changed.
2. `npm version patch|minor|major` — bumps `package.json`, commits `x.y.z`, tags `vx.y.z`.
   Semver: patch for fixes, minor for new behavior or API (e.g. a ranking change), major for
   breaking changes.
3. `git push origin main --follow-tags` — the tag triggers `release.yml`, which checks that the tag
   matches `package.json`, builds, publishes, and creates the GitHub release.
4. Verify: `gh run list --limit 3` (the `Release` run should succeed in ~25 s) and
   `npm view ai-vision version --prefer-online`. The registry can lag a minute behind the run;
   retry `npm view` before concluding anything failed.

Pushing and tagging are outward-facing: do them only when the user has asked for a release.

## Updating Persephone after a release

```sh
cd C:\projects\persephone
npm install ai-vision@^x.y.z --prefer-online   # updates package.json + package-lock.json
```

Persephone's dev server (`npm start`, Vite) pre-bundles dependencies, so a new ai-vision version
takes effect only after **restarting the dev server**; HMR will not pick it up. The main process
also imports ai-vision (the MCP resolver), so the restart covers both sides. Then re-check the
changed behavior through Persephone's MCP `call` tool.

## Working agreements

- **Generic library.** No Persephone-specific names, synonyms, paths, or concepts in this repo.
  App vocabulary belongs in the app's descriptor summaries, not in ai-vision's matching or ranking.
- **Zero runtime dependencies**, ESM only, runs in Node and browsers.
- **Designed for agents reading results, not people.** Errors list valid alternatives; results are
  bounded (`maxLength`, array and depth caps) to protect the agent's context. The exception: a
  top-level image record (`{ type: "image", data, mimeType }`) is returned whole, because clients
  send it as an image, not text.
- **Never expose internals.** Results go through descriptors and `summarize()`; plain class
  instances without a descriptor are not dumped. `restricted()` gates a whole subtree.
- **Public types are a contract** with Persephone and with boards using `remote`/`dom`: prefer
  adding optional fields to changing existing ones; a breaking change needs a major version.
- Commit trailers: attribute every agent that contributed, e.g.
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Co-authored-by: Codex <noreply@openai.com>`.
