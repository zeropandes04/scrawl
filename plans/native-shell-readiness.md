# Feature Implementation Plan: Native shell readiness

**Overall Progress:** `60%` (Steps 1-3 done; Step 4 bundling and Step 5 canvas-only mode later)

## TLDR
The plan is to keep improving the web app, then wrap it in a native shell: SwiftUI (iOS) and Jetpack Compose (Android) controls around this canvas running in a web view. This plan audits the app against the four habits in CLAUDE.md ("Native shell readiness") and lists the changes that make the later wrapping a matter of wiring, not rework. Nothing here changes what users see in the browser.

## Critical Decisions
- **No native code yet.** This plan only prepares the web app; the shell itself is a later project (and, given the "no package manager" rule, would live in its own folder or repository).
- **One public API object, not a framework.** The shell talks to the page through a single `window.scrawlface` object: functions to call plus a state snapshot and one "state changed" callback. No event bus or new abstraction layers.
- **Swap points are single functions.** Each browser-only feature (share, download, haptics, prompts, storage) ends up behind exactly one function, so the shell replaces one function per feature.
- **Bundle, don't fetch.** p5.js and the wordmark fonts become local files. p5 is the same library and version (1.4.0), only served from the repo, so no new dependency; still flagged for approval because it adds ~800KB to the repo.

---

## Audit

### 1. Engine apart from controls
**Mostly good.** Most keys call engine functions directly: `requestNewScrawl`, `rotateCanvas`, `toggleEyes`, `clearDrawings`, `undo`, `redo`, `setTool`, `setEyeStyles`, `mixEyes`, `saveToGallery`, `openFromGallery`.

**Logic that only lives inside click handlers** (a native toolbar couldn't trigger it):
| Behaviour | Where | Problem |
|---|---|---|
| Set brush / eraser size | `setupToolbar`, `[data-size]` click | Sets `brushSize` / `eraserSize` inline |
| Set brush colour | `setupToolbar`, `[data-color]` click | Sets `brushColor` and the `--brush-color` CSS variable inline |
| Set loops | `setup`, slider `input` | Sets `intensity` inline |
| Pick an eye set / Mix | `setupEyeSetButtons` | `setEyeStyles` / `mixEyes` + `markChanged()` only in the handler |
| Share vs Download | `setupToolbar` | The choice (touch + `canShare`) is made while wiring the keys |

**The engine also updates the web controls directly** (the other direction): `enableClearButton`, `updateUndoRedoButtons`, `updateToolButtons`, `updateGallerySaveButtons`, `updateScrawlToggleButtons`, `updateEyeSetButtons`, `flashSaved`, and `leaveBlankStart` are called from engine functions (`swapState`, `floodFill`, `generateScrawlface`, `restoreScrawlface`, `saveToGalleryNow`, ...). That's fine for the web, but a native toolbar has no way to learn that, say, Undo just became available.

### 2. Browser-only features
| Feature | Where | Native replacement |
|---|---|---|
| Share | `shareImage` (`navigator.share`) | Native share sheet |
| Download | `downloadImage` (link click) | Save to Photos / Files |
| Vibration | 3 places: key buzz (`setup`), hold-to-peek (`startLinesPeek`), gallery long press (`renderGallery`) | Native haptics (iPhones ignore `navigator.vibrate`) |
| Prompts | `confirm()` (no-storage New), `alert()` ×4 (save / open failures), `<dialog>` Save/Discard and Delete | Native alerts / sheets |
| Gallery + draft storage | `dbRequest` (IndexedDB) | Can stay (works in a web view); optionally native files later |
| Small preferences | `localStorage`: wordmark font, "created one before" | Can stay |
| Touch vs mouse | `matchMedia` in `setupToolbar` | Shell decides |

**Good already:** storage goes through one function (`dbRequest`), and Share / Download are one function each.

### 3. External dependencies
| Asset | Today | Plan |
|---|---|---|
| p5.js 1.4.0 | CDN (`cdnjs`) | Local copy, e.g. `vendor/p5.min.js` |
| Wordmark fonts (14, random per load) | Google Fonts, fetched per load with `&text=Scrawlface` | Local `.woff2` subsets of the 10 letters, in `fonts/`, with their OFL licences |

**Also found:** `icons/` (4 PNGs) isn't referenced anywhere; the keys use inline SVG. Dead assets; remove them and the CLAUDE.md line.

### 4. Canvas fits any container
**Good:** `fitCanvasToContainer` covers and masks to whatever `#scrawl-container` is, and pointer coordinates come from the canvas's own box.

**Gaps for a shell that shows only the canvas:**
- The page always draws its own chrome (header, sidebar, bottom bar, blank-start overlay inside the container). There's no "canvas only" way to load it.
- Window-wide listeners (keyboard shortcuts, Escape, the key buzz, document clicks for the ⋯ menu) assume the web chrome exists. They're harmless if the chrome is hidden, but they should be checked.

---

## Tasks

- [x] 🟩 **Step 1: Engine functions for the inline logic**
  - [x] 🟩 `setBrushSize(n)` / `setEraserSize(n)`, `setBrushColor(hex)`, `setLoops(n)`: move the handler bodies into them; the handlers call them
  - [x] 🟩 `pickEyeSet(name)` / `mixEyes()` include `markChanged()` (`setEyeStyles` alone stays change-free: opening a saved scrawlface uses it)
  - [x] 🟩 Behaviour and markup unchanged; existing tests must pass as they are

- [x] 🟩 **Step 2: State out, for any toolbar**
  - [x] 🟩 `appState()`: tool, sizes, colour, loops, eye styles, lines shown, can undo / redo, has drawings, blank start, unsaved changes, saved
  - [x] 🟩 `stateChanged()`: called from the existing `update*` functions (one line each); a burst of changes is reported once, and with no listener it does nothing
  - [x] 🟩 `window.scrawlface = { ...the engine functions, appState, onStateChange }`: the single surface the shell uses

- [x] 🟩 **Step 3: One swap point per browser-only feature**
  - [x] 🟩 `exportPNG()` → `Promise<Blob>`: the one picture source; `shareImage` / `downloadImage` use it
  - [x] 🟩 `haptic(kind)`: replaces the three `navigator.vibrate` calls
  - [x] 🟩 `showError(message)` for the `alert()`s; the Save/Discard and Delete prompts each already sit in one function (`confirmLeave`, `confirmDelete`): leave those as the swap points
  - [x] 🟩 Storage stays IndexedDB through `dbRequest` (already one place)

- [ ] 🟥 **Step 4: Bundle the remote assets** *(needs your approval: adds ~800KB)*
  - [ ] 🟥 `vendor/p5.min.js` (1.4.0) instead of the CDN
  - [ ] 🟥 `fonts/` with the 14 wordmark subsets + licences; `loadWordmarkFont` uses `@font-face` on local files
  - [ ] 🟥 Remove the unused `icons/` and its CLAUDE.md line
  - [ ] 🟥 Check the page works fully offline (the smoke test can block all network)

- [ ] 🟥 **Step 5: Canvas-only mode**
  - [ ] 🟥 A body class (e.g. `embedded`, set by `?embedded` or by the shell) hides the header, sidebar, bottom bar and blank-start overlay, and lets `#scrawl-container` fill the window
  - [ ] 🟥 Keyboard shortcuts and document-wide listeners stay harmless in that mode
  - [ ] 🟥 Smoke test runs a pass in canvas-only mode, driving the app only through `window.scrawlface`

## Risks
- **Step 1–2 touch the same code as undo and the keys.** Small moves, but the tests should run after each step; no change to the undo stack itself.
- **Step 4 adds binary files to the repo.** ~800KB for p5, a few KB per font subset.
- **Step 5's layout** is a new mode, not a change to the existing one; the regular layout sweep must stay identical.

## Testing
- Existing `tests/smoke.js` and `tests/gallery.js` after every step, unchanged where behaviour is unchanged.
- New: drive a full happy path (New → eyes → brush → fill → undo/redo → export) through `window.scrawlface` only, in canvas-only mode.
- New: the page loads and works with the network blocked (after Step 4).
- Layout sweep across the usual window sizes: identical before and after.
