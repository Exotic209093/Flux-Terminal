# Packaging — design (Windows NSIS installer, unsigned)

**Date:** 2026-06-10
**Status:** approved (James) — ready to plan.

## Goal

Make Flux installable as a real double-click app: fix the production build so it actually renders (today the `file://` build shows a blank window), and produce a Windows NSIS installer via electron-builder. Unsigned for now.

## Decisions (confirmed with James)

- **Installer:** NSIS (.exe setup wizard, Start-menu + desktop shortcuts, uninstaller).
- **Signing:** UNSIGNED for now — Windows SmartScreen will show "unknown publisher" (one-time "More info → Run anyway"). Config structured so a cert (electron-builder `win.signtoolOptions`/`certificateFile`+`certificatePassword`, or Azure Trusted Signing) can be added later in a few lines. (Cert options noted: OV ~$200-400/yr + hardware token; EV ~$300-700/yr instant trust; Azure Trusted Signing ~$10/mo if eligible.)
- **Render fix:** custom `app://` protocol (not `loadFile`).

## The core bug + fix

`src/main/index.js` loads the built renderer via `mainWindow.loadFile('../renderer/index.html')` in production. The built `out/renderer/index.html` loads the app as `<script type="module" crossorigin src="./assets/…">`; under the `file://` protocol Electron blocks ES-module loads by CORS, so the React app never executes and the window is blank (confirmed earlier — `file://` renders blank; only `npm run dev` over `http://localhost` works).

**Fix:** register a privileged custom scheme and serve the built files over it.
1. Before `app.whenReady`, `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])`.
2. In `whenReady`, register a handler: `protocol.handle('app', (request) => …)` that maps `app://./<path>` to a file under `out/renderer/` and returns its bytes with the right MIME (use `net.fetch('file://…')` over the resolved on-disk path, or read + `new Response`). Resolve `app://./index.html` → `out/renderer/index.html`, `app://./assets/x.js` → `out/renderer/assets/x.js`. Guard against path traversal (resolve within the renderer dir).
3. In production (`!ELECTRON_RENDERER_URL`), `mainWindow.loadURL('app://./index.html')` instead of `loadFile`. Dev path unchanged.

Because `app://` is registered as a `standard` + `secure` scheme, ES modules load without the `file://` CORS block.

## electron-builder config

- New devDep `electron-builder`.
- `electron-builder.yml` (or `build` key): `appId: com.fluxterminal.app`, `productName: Flux Terminal`, `directories.output: dist`, `files: ['out/**/*', 'package.json']`, `asar: true`, `asarUnpack: ['**/node_modules/node-pty/**']` (native `.node` must load from disk, not asar), `win: { target: ['nsis'], icon: 'build/icon.ico' }`, `nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true }`.
- Scripts: `"dist": "electron-vite build && electron-builder"`, optionally `"dist:dir": "electron-vite build && electron-builder --dir"` (unpacked, faster for testing without building the NSIS installer).
- The `ensure-electron` postinstall is dev-only (repairs the dev Electron binary); electron-builder downloads its own Electron for packaging.

## App icon

electron-builder needs `build/icon.ico` (256px ideally). Generate a simple branded icon (the ⚡ Flux mark, accent `#89b4fa` on the dark `#0b0e14` bg) — bake a PNG and convert to multi-size `.ico` so there's no missing-asset failure. Swap later if desired.

## Risks

- **extract-zip stall:** the known Node24+Electron42 quirk that breaks the dev Electron extract could also hit electron-builder's Electron download/extraction. If it stalls, work around (clear cache / use the already-extracted dev binary / set `ELECTRON_BUILDER_CACHE`). Document whatever was needed.
- **node-pty in the package:** the only true proof the asarUnpack is right is launching the INSTALLED app and spawning a terminal. Verify it.
- **Large artifacts:** the installer is ~100-150 MB and the build is slow; that's expected.

## Testing / verification

1. `npm test` still green (no source regressions from the protocol change).
2. `npm run build` succeeds; the custom-protocol production path is exercised by a real launch of the built app (NOT dev): launching `out`-based Electron must now RENDER (not blank). Verify with a screenshot of the built (non-dev) app — this is the key proof the protocol fix works.
3. `npm run dist` (or `dist:dir` first) produces the installer / unpacked app.
4. **Install + launch the packaged app:** run `dist/Flux Terminal Setup 0.1.0.exe`, launch the installed app, confirm it RENDERS the full UI and a terminal spawns (node-pty loads from the unpacked asar). Screenshot the installed app.

## Non-goals

- Code signing (documented for later), auto-update, macOS/Linux targets, CI/release automation, delta updates.
