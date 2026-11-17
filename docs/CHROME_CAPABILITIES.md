# Chrome Platform Capabilities, Workarounds & Upgrade Playbook

This document tracks **which Chrome version each Arctic feature targets**, **why specific platform workarounds exist**, **where those workarounds live in the codebase** (tagged with `@chrome-workaround(<id>)`), and **what future Chrome APIs will allow us to upgrade or simplify them**.

Instead of manually monitoring Chrome release notes every month, run:
```bash
# Audit local @types/chrome against our baseline & verify all @chrome-workaround tags:
npm run check:chrome-apis

# Check upstream @types/chrome (latest published on npm) for newly released Chrome APIs:
npm run check:chrome-apis:remote
```
A scheduled GitHub Action ([`.github/workflows/chrome-api-watch.yml`](../.github/workflows/chrome-api-watch.yml)) also runs `check:chrome-apis:remote` monthly and automatically opens a GitHub Issue whenever a watched Chrome API lands.

---

## 1. Chrome Version Baseline Matrix (Current Features)

| Feature / API Used in Arctic | Chrome Version Introduced | Progressive Fallback? | Key Files |
| :--- | :--- | :--- | :--- |
| `chrome.sidePanel` (`setPanelBehavior`, `setOptions`) | **Chrome 114** | Required baseline (MV3) | [`manifest.json`](../manifest.json), [`src/background/index.ts`](../src/background/index.ts) |
| `chrome.sidePanel.open({ windowId / tabId })` | **Chrome 116** | Falls back to toolbar click toast | [`src/background/index.ts`](../src/background/index.ts), [`src/newtab/App.tsx`](../src/newtab/App.tsx) |
| `chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })` | **Chrome 116** | Falls back to connected `sidePanelPorts` + `storage.session` | [`src/background/index.ts`](../src/background/index.ts) |
| `chrome.storage.session.setAccessLevel` | **Chrome 102** | Wrapped in feature detection | [`src/background/index.ts`](../src/background/index.ts) |
| `chrome-extension://<id>/_favicon/` | **Chrome 104** | Falls back to `tab.favIconUrl` + monogram | [`src/sidepanel/utils/url.ts`](../src/sidepanel/utils/url.ts), [`src/sidepanel/utils/faviconCache.ts`](../src/sidepanel/utils/faviconCache.ts) |
| `chrome.search.query` (Default Search Engine) | **Chrome 87** | Falls back to Google search URL | [`src/newtab/App.tsx`](../src/newtab/App.tsx) |
| `chrome.sidePanel.getLayout()` (`side: 'left' \| 'right'`) | **Chrome 140** | Falls back to `storage.local.sidebarDockSide` (`'left'`) | [`src/background/index.ts`](../src/background/index.ts) |

---

## 2. Active Chrome Workarounds & Upgrade Playbook

Every workaround in the source code is annotated with `// @chrome-workaround(<id>)` so `npm run check:chrome-apis` (or `grep -rn "@chrome-workaround" src/ public/ newtab.html`) can locate every line to update.

### `newtab-omnibox-focus` — New Tab Page Focus & Extension URL in Address Bar
- **Current Chrome Limitation**:
  1. Overriding `chrome_url_overrides.newtab` in Manifest V3 forces keyboard focus into Chrome's native address bar (Omnibox) instead of the page's search input, with no manifest flag to opt out.
  2. Spawning a regular extension tab via `chrome.tabs.create({ url: 'command.html' })` lets the page claim keyboard focus immediately, but displays `chrome-extension://<id>/command.html` in the Chrome address bar and can leave behind unfocused command tabs if the user switches tabs without navigating.
- **Current Arctic Workaround**:
  - [`newtab.html`](../newtab.html) loads [`public/focus.js`](../public/focus.js), which calls `chrome.tabs.create({ url: chrome.runtime.getURL('command.html'), active: true })` and removes the transient `newtab.html` tab.
  - [`src/sidepanel/hooks/useTabBindings.ts`](../src/sidepanel/hooks/useTabBindings.ts) (`closeInactiveArcticCommandTabs`) automatically closes unfocused `command.html` / `newtab.html` tabs when the user switches to another tab.
- **Future Chrome API Signal to Watch**:
  - `chrome_url_overrides.newtab` supporting focus control (e.g. `focus_page` or `steal_focus: false`), **or**
  - `chrome.tabs.CreateProperties` / `UpdateProperties` supporting `focusPage: true` on `chrome://newtab` or URL masking (`hideUrl` / `displayUrl`).
- **Upgrade Action When Available**:
  - Render `command.html` directly inside `newtab.html`, delete `public/focus.js`, and remove transient redirect handling in `closeInactiveArcticCommandTabs`.

---

### `sidepanel-close-and-visibility` — Programmatic Side Panel Close & Open State Tracking
- **Current Chrome Limitation**:
  - Historically `chrome.sidePanel` had no `close()` method and no `onOpened` / `onClosed` events, nor a synchronous `isOpen(windowId)` query.
- **Current Arctic Workaround**:
  - [`src/sidepanel/App.tsx`](../src/sidepanel/App.tsx) (`prepareAndCloseSidePanel`) sends `PREPARE_HIDE_SIDEBAR` / `SIDEPANEL_WILL_CLOSE` to the service worker and calls `window.close()` inside `sidepanel.html`.
  - [`src/background/index.ts`](../src/background/index.ts) (`getStoredOpenWindowIds`, `handleSidePanelPortConnect`) combines a persistent `chrome.runtime.Port` (`arctic-sidepanel`), `chrome.storage.session`, and `chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })` with opening/closing guard timers.
- **Future Chrome API Signal to Watch**:
  - `chrome.sidePanel.close({ windowId / tabId })` (landed in newer Chrome 146+; watch for appearance in `@types/chrome`)
  - `chrome.sidePanel.onOpened` and `chrome.sidePanel.onClosed` lifecycle events.
- **Upgrade Action When Available**:
  - Use `chrome.sidePanel.close({ windowId })` directly from background commands/shortcuts and replace the port/guard-timer state machine with `chrome.sidePanel.onOpened` / `onClosed`.

---

### `sidepanel-open-user-gesture` — Opening Side Panel on Edge Hover
- **Current Chrome Limitation**:
  - `chrome.sidePanel.open()` (Chrome 116+) strictly requires a transient user activation token (`click` / `keydown`). Hover events (`mouseenter` / `pointermove`) are not treated by Chromium as user activation, and any `await` in the message listener before `chrome.sidePanel.open()` expires the gesture token.
- **Current Arctic Workaround**:
  - [`src/background/index.ts`](../src/background/index.ts) (`OPEN_SIDE_PANEL_FROM_EDGE`) invokes `chrome.sidePanel.open({ windowId })` synchronously on the first tick before any `await`.
  - In `hover` mode ([`src/content/edgeTrigger.ts`](../src/content/edgeTrigger.ts)), hovering the screen edge slides out Arctic's 36px in-page Shadow DOM rail (which can switch tabs directly), while clicking its expand button forwards the user gesture to open the full native Chrome Side Panel.
- **Future Chrome API Signal to Watch**:
  - Relaxation of the user-gesture requirement on `chrome.sidePanel.open()`, or a native `openPanelOnEdgeHover` property in `chrome.sidePanel.PanelBehavior`.
- **Upgrade Action When Available**:
  - Allow optional zero-click hover expansion of the full native Side Panel when the user touches the screen edge.

---

### `sidepanel-min-width-and-resize` — Slim Collapsed Sidebar Width & Dynamic Resizing
- **Current Chrome Limitation**:
  - Chrome enforces a minimum width (~320–360px) on the native Side Panel container and provides no `chrome.sidePanel.setSize()`, `minWidth`, or collapsed icon-rail mode.
  - Furthermore, content scripts cannot run on `chrome://` pages or the Chrome Web Store.
- **Current Arctic Workaround**:
  - [`src/content/edgeTrigger.ts`](../src/content/edgeTrigger.ts) injects a 36px Shadow DOM rail into web pages when the Side Panel is hidden, including a 2-pass CSS page-push engine (`html[data-arctic-edge-push]`) that shifts webpage content and fixed headers inward by 36px without overlapping.
  - [`src/newtab/components/NewTabEdgeTrigger.tsx`](../src/newtab/components/NewTabEdgeTrigger.tsx) mirrors the same 36px rail inside `command.html`.
- **Future Chrome API Signal to Watch**:
  - `chrome.sidePanel.setOptions({ width, minWidth })`, `chrome.sidePanel.setSize()`, or native collapsible mini-rail support in `chrome.sidePanel`.
- **Upgrade Action When Available**:
  - Collapse the native Side Panel directly to 36px width instead of closing it and injecting `edgeTrigger.ts` into web pages—eliminating the `chrome://` and Chrome Web Store page limitation entirely.

---

### `sidepanel-dock-layout` — Docking the Side Panel on the Left vs. Right
- **Current Chrome Limitation**:
  - Chrome 140+ added `chrome.sidePanel.getLayout()` to *read* which side the panel is docked on (`left` or `right`), but still provides no `chrome.sidePanel.setLayout({ side: 'left' })` to change it from an extension.
- **Current Arctic Workaround**:
  - [`src/background/index.ts`](../src/background/index.ts) (`syncSidePanelLayoutSide`) reads `chrome.sidePanel.getLayout()` via a runtime feature check + type cast (since `@types/chrome@0.0.308` predates `getLayout`).
  - [`src/sidepanel/components/SettingsModal.tsx`](../src/sidepanel/components/SettingsModal.tsx) provides a one-click button that opens `chrome://settings/appearance` so the user can select *"Show on left"*.
- **Future Chrome API Signal to Watch**:
  - `chrome.sidePanel.getLayout` landing in `@types/chrome` (remove type cast in `syncSidePanelLayoutSide`).
  - `chrome.sidePanel.setLayout` or `PanelBehavior.side` landing in `chrome.sidePanel`.
- **Upgrade Action When Available**:
  - Replace the `chrome://settings/appearance` external link in `SettingsModal.tsx` with an instant in-app **Left / Right** toggle calling `chrome.sidePanel.setLayout({ side })`.

---

### `tab-page-focus-and-media-keys` — Transferring Keyboard & Media Focus to the Active Tab
- **Current Chrome Limitation**:
  - When a user clicks a tab row inside `sidepanel.html` (`chrome.tabs.update(tabId, { active: true })`), Chromium switches the visible tab but keeps OS keyboard focus inside the Side Panel's `WebContents`. Pressing `Space`, arrow keys, or `J/K/L/M` therefore interacts with the sidebar instead of scrolling the page or controlling a YouTube/video player.
- **Current Arctic Workaround**:
  - [`src/sidepanel/utils/tabPageFocus.ts`](../src/sidepanel/utils/tabPageFocus.ts) blurs pointer-clicked sidebar rows (`blurSidebarActiveElementIfPointer`), injects `focusPageOrPlayerInDocument` to focus active video players, and bridges `Space`, `Arrow*`, `PageUp/Down`, `Home/End`, and `J/K/L/M` keystrokes from `sidepanel.html` into the active tab via `chrome.scripting.executeScript`.
- **Future Chrome API Signal to Watch**:
  - `chrome.tabs.UpdateProperties` adding `focusPage: true` / `focusWebContents: true`, or `chrome.sidePanel` adding a method to return focus to the active tab's `WebContents`.
- **Upgrade Action When Available**:
  - Call the native focus-transfer API on pointer-activated tab switches and bypass `chrome.scripting.executeScript` key forwarding when supported.

---

### `content-script-favicon-isolation` — Rendering Chrome Favicons in Content Scripts
- **Current Chrome Limitation**:
  - `chrome-extension://<id>/_favicon/` URLs load cleanly inside extension pages (`sidepanel.html`, `command.html`), but content scripts (`edgeTrigger.ts`) running inside web page origins are blocked by Chromium cross-origin restrictions from loading `_favicon` URLs directly in `<img>` tags.
- **Current Arctic Workaround**:
  - [`src/sidepanel/utils/faviconCache.ts`](../src/sidepanel/utils/faviconCache.ts) and [`src/background/index.ts`](../src/background/index.ts) (`resolveFaviconDataUrl`) fetch, verify, and cache favicons as `data:image/...;base64` URLs in `chrome.storage.local` and broadcast them to `edgeTrigger.ts`.
- **Future Chrome API Signal to Watch**:
  - Cross-context `chrome.favicon` API or allowing `_favicon` in isolated-world content scripts / Shadow DOM roots.

---

## 3. Future Roadmap (Waiting on Upcoming Chrome APIs)

| Desired Experience | Current Chrome Status | API Signals Watched by `check:chrome-apis` |
| :--- | :--- | :--- |
| **Split View / Splitting Tabs Side-by-Side** | Chromium has built-in Split View in desktop Chrome, but has not yet exposed split-tab creation or inspection to extensions. | `chrome.tabs.split`, `chrome.tabs.unsplit`, `Tab.splitViewId`, `chrome.splitView` |
| **Hiding Chrome's Native Top Tab Strip / Address Bar** | Chrome does not expose a `browserSettings` or `windows` API to hide the horizontal tab bar when a vertical tab sidebar is open. | `chrome.windows` / `chrome.tabs` (`hideTabStrip`, `tabStripVisible`, `toolbarVisible`) |

---

## 4. How the Automated Chrome API Monitor Works

1. **Baseline Snapshot ([`scripts/chrome-api-baseline.json`](../scripts/chrome-api-baseline.json))**:
   Records the exact functions, events, interfaces, and option properties currently present in our installed `@types/chrome` across `chrome.sidePanel`, `chrome.tabs`, `chrome.windows`, `chrome.commands`, and `chrome.runtime`, along with pattern-matching **Watch Rules** mapped to each `@chrome-workaround(<id>)`.
2. **Checker Script ([`scripts/checkChromeApis.mjs`](../scripts/checkChromeApis.mjs))**:
   - **`npm run check:chrome-apis`** (Local):
     - Scans the codebase to verify every `@chrome-workaround(<id>)` tag is valid and lists its exact `file:line` location.
     - Diffs `node_modules/@types/chrome/index.d.ts` against `scripts/chrome-api-baseline.json` (so whenever you bump `@types/chrome`, it immediately tells you what new Chrome APIs became available and which workarounds they unlock).
   - **`npm run check:chrome-apis:remote`** (Remote / Upstream):
     - Fetches the latest published `@types/chrome/index.d.ts` from npm/unpkg without changing your local `node_modules`.
     - Reports any newly published methods, events, or option properties in our watched namespaces and highlights any matched `@chrome-workaround` upgrade opportunities.
   - **`npm run check:chrome-apis:update`**:
     - Updates `scripts/chrome-api-baseline.json` after you review and adopt new APIs.
3. **Monthly GitHub Action ([`.github/workflows/chrome-api-watch.yml`](../.github/workflows/chrome-api-watch.yml))**:
   - Runs automatically on the 1st of every month (and supports manual one-click runs via **Actions $\rightarrow$ Chrome API Watch $\rightarrow$ Run workflow**).
   - If upstream `@types/chrome` has new methods or properties in our watched namespaces, the workflow automatically creates or updates a GitHub Issue with the full upgrade report and file links.
