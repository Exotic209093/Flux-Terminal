# Contributing to Flux Terminal

## Where the project lives

Clone to a normal path such as `C:\Users\you\Projects\Flux Terminal`.
**Do not put it under OneDrive** — OneDrive dereferences `node_modules`
junctions and corrupts Electron's ~140 MB binary extraction.

## Setup

```powershell
npm install     # postinstall repairs Electron's binary (see below)
npm run dev     # launch with hot reload
```

If you see "electron.exe missing", run `npm run fix-electron`. On this
toolchain (Node 24 + Electron 42) Electron's own `extract-zip` postinstall can
stall after the first zip entry; `scripts/ensure-electron.cjs` re-extracts it.

`node-pty` needs no native rebuild — v1.1+ ships N-API prebuilds. The packaging
config sets `npmRebuild: false` on purpose; a gyp rebuild fails because the repo
path contains a space ("Flux Terminal").

## Tests

```powershell
npm test                              # all tests
node --test tests/parser-stream.test.js   # one file
```

Tests use Node's built-in runner. The glob form (`"tests/**/*.test.js"`) is
required — `node --test tests/` fails on Windows Node 24.

Pure logic (everything in `src/main/*.js` and `src/renderer/src/lib/*.js`) is
unit-tested. There is no JSX test runner; React components are verified by
`npm run build` and manual runs.

## Build & package

```powershell
npm run build      # bundle main + preload + renderer into out/
npm run dist       # unsigned Windows NSIS installer into dist/
```

Every new `src/main/*.js` module MUST be added to the `rollupOptions.input` map
in `electron.vite.config.mjs`, or the built app boots with "Cannot find
module './x'".
