# Settings page + unified settings store — design

**Date:** 2026-06-11
**Status:** designed (awaiting plan + implementation)

## Goal

Consolidate Flux's scattered settings (sidebar theme dropdown, the ⚙ notifications popover, the topbar model picker, and a split of `localStorage` + `settings.json` storage) into a **dedicated Settings page** backed by a **single source of truth** (`settings.json`). Provide a clean, extensible foundation so new settings are trivial to add.

## Decisions (confirmed with James)

- **Form:** a dedicated full **Settings page** — a new view in the main pane (peer of Stats/Skills/Mission), with a **left category rail + content panel + search box**. (Not a modal; not an expanded popover.)
- **Storage:** **consolidate into `settings.json`** as the single source of truth. Migrate the renderer-only `localStorage` prefs (`flux.theme`, `flux.animations`, `flux.model`) into the store. Accept the extra work of avoiding a startup theme-flash (handled below).
- **Categories:** Appearance, Notifications, Terminal, Models, About.
- **Quick-access kept:** the sidebar theme dropdown and topbar model picker remain (now store-backed); the standalone background-animation toggle moves into the page; the ⚙ gear opens the page (the notifications-only popover is retired).
- **Animation pref becomes tri-state** `'auto' | 'on' | 'off'` (`'auto'` follows OS reduced-motion — preserves current behavior).

## Architecture

### 1. Settings store (`src/main/settings.js`)

Extend `SettingsStore` (file: `userData/settings.json`) so the shape becomes:

```
{
  version: 2,
  appearance: { theme: 'midnight', animations: 'auto', model: <DEFAULT_MODEL> },
  notify: { turnFinished, turnError, blocked, usageThreshold, sound, muted },
  profiles: [...],
  workspace: <layout|null>,
  appearanceMigrated: false
}
```

- `DEFAULTS` gains `appearance` (theme `'midnight'`, animations `'auto'`, model = the renderer's `DEFAULT_MODEL` value, duplicated as a constant in main to avoid importing renderer code) and `appearanceMigrated: false`.
- `_load` bumps to version 2 and **carries old files forward**: a v1 file (no `appearance`) loads with default appearance + `appearanceMigrated: false`; unknown/legacy keys ignored as today.
- New methods: `getAppearance()`, `setAppearance(key, value)` with validation — `theme` must be a non-empty string; `animations` ∈ `{'auto','on','off'}`; `model` a non-empty string. `setMigrated(bool)`.
- Keep existing `notify`/`profiles`/`workspace` methods unchanged.
- Pure helper `mergeLegacyAppearance(current, legacy)` (exported) → returns the appearance object after merging legacy localStorage values (legacy wins where present and valid), used by the renderer migration. Unit-tested.

### 2. No-flash delivery — synchronous initial settings

- **main (`index.js`):** in `whenReady`, construct `settingsStore` and register a **synchronous** handler `ipcMain.on('settings:getSync', (e) => { e.returnValue = settingsStore.get() })` and a generic `ipcMain.handle('settings:set', (_e, { path, value }) => settingsStore.setByPath(path, value))` **before** `createWindow()` so the value is ready when the renderer boots. (`setByPath` dispatches to `setAppearance`/`setNotify`/etc. based on a small allow-list; returns the updated full settings.)
- **preload (`src/preload/index.js`):** `const initialSettings = ipcRenderer.sendSync('settings:getSync')`; expose `window.flux.settings.initial = initialSettings` plus async `get()`, `set(path, value)`, and the existing profile/workspace methods. `setByPath` handles dotted paths `appearance.<k>`, `notify.<k>`, and `appearanceMigrated` (validating each via the matching setter); the legacy `settings:setNotify` IPC remains for back-compat but new code uses `set`.
- **renderer entry (`src/renderer/src/main.jsx`):** synchronously read `window.flux.settings.initial`, run migration (below), then `applyTheme(theme, { motion })` **before** rendering `<App>` → first paint is already themed (no flash).

### 3. One-time migration

On renderer boot, before first paint, if `initial.appearanceMigrated` is false:
1. Read legacy `localStorage` keys `flux.theme`, `flux.animations` (legacy was `'1'|'0'|null`), `flux.model`.
2. Compute `mergeLegacyAppearance(initial.appearance, legacy)` (legacy wins where present/valid; legacy `flux.animations` `'1'→'on'`, `'0'→'off'`, absent→leave `'auto'`).
3. Apply the merged theme synchronously (no flash even on this upgrade launch), persist each changed key via `settings:set`, call `set('appearanceMigrated', true)`, and remove the three legacy `localStorage` keys.
Fresh installs (no legacy keys) simply set `appearanceMigrated: true`.

### 4. Renderer settings layer

- `SettingsProvider` (React context) + `useSettings()` hook in `src/renderer/src/lib/settings-context.jsx`. Seeded synchronously from `window.flux.settings.initial` (post-migration value). Exposes `settings` (the object) and `update(path, value)` → calls `window.flux.settings.set(path, value)`, then updates context state from the returned settings.
- A context effect applies side effects on change: `applyTheme(settings.appearance.theme, { motion: resolveMotion(settings.appearance.animations) })` where `resolveMotion('auto') = !prefersReducedMotion()`, `'on'→true`, `'off'→false`. (`appearance.js`'s `resolveAnimations`/`prefersReducedMotion` are reused/adapted; `loadAnimations`/`saveAnimations` localStorage helpers are removed once migration is in place.)
- Components (Sidebar theme dropdown, topbar model picker, ThemeBackground, the Settings page sections) read from `useSettings()` and call `update(...)` — one access point, no scattered localStorage/IPC.

### 5. The Settings page

- New `view === 'settings'` in `App.jsx` (peer of stats/skills/mission), shown in a `.pane-slot`. Opened by the ⚙ gear in `ControlBar` (which now calls a callback to switch the view instead of toggling the popover; `SettingsPopover` is removed). Optional Ctrl+, shortcut.
- `SettingsPage.jsx` (shell): left rail (category list from a registry) + search input + content area that renders the active category's section component.
- A registry array `SETTINGS_CATEGORIES = [{ id, label, icon, Section }]` drives the rail. Search filters a flat list of simple setting entries (label/description/category) and jumps to / highlights matches; complex widgets are still reachable by category.
- Section components (each focused, in `components/settings/`): `AppearanceSection` (theme swatch grid of all 7 themes + animation Auto/On/Off segment), `NotificationsSection` (4 event 3-way segments + sound + mute via `useSettings().update('notify.<key>', value)`; test button calls `window.flux.notify.test()`), `TerminalSection` (shell profiles list add/edit/delete via existing `profiles`/`saveProfile`/`deleteProfile` + default-profile selector), `ModelsSection` (default model `<select>` from `lib/models`), `AboutSection` (app version + GitHub repo link).
- App version for About: `ipcMain.handle('app:version', () => app.getVersion())` exposed via preload `window.flux.app.version()`.

### 6. UI integration details

- Remove `SettingsPopover.jsx` and its CSS usage; the gear opens the page.
- Sidebar theme dropdown and topbar model picker stay but read/write via `useSettings()`.
- ThemeBackground + `applyTheme` driven by the store's `appearance` instead of `localStorage`.

## Files touched

- `src/main/settings.js` — add `appearance` + `appearanceMigrated`, version 2 load-forward, `getAppearance`/`setAppearance`/`setMigrated`/`setByPath`, exported `mergeLegacyAppearance`.
- `src/main/index.js` — construct store + register `settings:getSync` (sync) and `settings:set` before `createWindow`; `app:version` handler.
- `src/preload/index.js` — `settings.initial` (sync), `settings.set`, `app.version`.
- `src/renderer/src/main.jsx` — sync initial read + migration + pre-render `applyTheme`.
- `src/renderer/src/lib/settings-context.jsx` — **new** provider/hook.
- `src/renderer/src/lib/themes.js` / `appearance.js` — `applyTheme` already takes `{motion}`; add `resolveMotion`; retire localStorage load/save helpers post-migration.
- `src/renderer/src/components/SettingsPage.jsx` + `components/settings/*Section.jsx` + registry — **new**.
- `src/renderer/src/App.jsx` — `settings` view, gear opens it, wrap in `SettingsProvider`, quick-access controls use the hook.
- `src/renderer/src/components/ControlBar.jsx` — gear opens page; remove popover; SettingsPopover.jsx deleted.
- `src/renderer/src/components/Sidebar.jsx` — theme dropdown via hook.
- `src/renderer/src/index.css` — Settings page styles (rail, search, rows, swatches, sections).
- Smoke harness in `index.js` — support `FLUX_SMOKE_VIEW=settings`.
- Tests: extend `tests/settings.test.js`; add a search-filter unit test.

## Testing / verification

1. **Unit tests** (`node --test`): `settings.js` — new appearance get/set + validation, version-1→2 load-forward, `mergeLegacyAppearance` (legacy wins, animations `'1'/'0'`→`'on'/'off'`, fresh-install path), and the page's pure search-filter helper. All existing tests stay green.
2. **Build** succeeds (`npm run build`).
3. **Migration check:** with a pre-existing `localStorage` theme set, launch the built app — it should boot to that theme (no flash), `settings.json` should now contain it, and `localStorage` keys should be cleared. Verify via the smoke harness + reading `settings.json`.
4. **Visual:** `FLUX_SMOKE_VIEW=settings` screenshot of each category (Appearance/Notifications/Terminal/Models/About); confirm theme switching from the page works and persists across relaunch; confirm the gear opens the page and quick-access controls still work.

## Non-goals

- No cloud sync, no import/export of settings, no per-project settings.
- No settings beyond consolidating existing ones + the listed categories (e.g., font size/density are future, not in this pass).
- No change to the notification engine, themes, or terminal behavior beyond moving their controls into the page and the store.
