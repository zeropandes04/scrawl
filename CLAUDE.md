# Scrawlface — Project Context

Single-page pareidolia art generator: draw a random scrawl, place "eyes" on it, doodle on top.

@CLAUDE.local.md <!-- local secrets, not committed -->

## Stack

- Frontend: Vanilla HTML/CSS/JS + p5.js (v1.4.0, bundled in `vendor/`)
- Hosting: static site — no build step, no package manager, no framework

## Architecture

- `index.html` — markup + all CSS (inline `<style>`), desktop sidebar + mobile bottom toolbar
- `scrawl.js` — all app logic: canvas setup, scrawl generation (bezier curves), brush/eraser/bucket tools, eye placement & dragging, undo/redo (memento pattern), mobile toolbar wiring
- `vendor/` — p5.js and its licence
- `fonts/` — the wordmark fonts (letter subsets) and their licences, see `fonts/README.md`

## Words in the UI

- **Scribble**: the random line drawing (New scribble, Loops for the next scribble).
- **Scrawlface**: the finished piece (scribble + eyes + paint), and the app's name. **My Scrawls** is where saved scrawlfaces live.
- "Scrawl" is only part of those names in the UI. The code still says scrawl for the drawing (`generateScrawlface`, `scrawlQueue`, ...); don't rename code for this.

## Hard rules

- No build step, no package manager, no framework — ever.
- No new CDN library without explicit approval. Additions are case-by-case, not default.
- Never modify CSS without flagging potential layout impact.
- Never refactor unrelated files when fixing a specific issue.
- Never introduce a new abstraction for a one-off use case.

## Quality bar

- Browser tests: `tests/smoke.js` (generate, eyes, doodle, undo/redo, fill, export) `tests/gallery.js` (Save, draft, My Scrawls) `tests/onboarding.js` (intro, help menu, tour, tips) and `tests/analytics.js` (every tracked event). See the header of `tests/smoke.js` to run them.

- Test on Chrome mobile after every change — that is the primary target.
- "No regressions" means manually walking the happy path: generate scrawl → place eyes → doodle → undo/redo.
- Every UI change must be verified on a small viewport before it's done.
- If a change touches the undo/redo stack, treat it as high risk and test edge cases explicitly (rapid actions, undo after bucket fill, undo after eye drag).

## Known gotchas

- **Undo/redo is the most fragile part.** The memento pattern implementation in `scrawl.js` is the most likely source of regressions. Approach changes here carefully.
- **Touch events on mobile canvas are risky.** p5.js touch handling can conflict with default browser scroll/zoom behaviour. Test on a real small viewport, not just DevTools resize.
- **View gestures come three ways.** Touch (pinch, hold to peek) on phones and tablets in any layout; on desktop, a trackpad pinch arrives as a wheel event with `ctrlKey`, Safari also sends `gesture*` events (with the turn), and press-and-hold peeks with a mouse or trackpad. Change one, check the others (`tests/smoke.js` covers all three).
- **Bump the script version.** `index.html` loads `scrawl.js?v=N`. Increase `N` in every change that touches `scrawl.js`, otherwise browsers can pair the new page with a cached old script (this showed up as a stretched canvas on mobile).
- **Units vs pixels.** Logic works in units: the picture frame is 800 x 1000 units around the 800 x 800 scrawl square, and the paint layer is bigger so it covers the frame at any rotation. The canvas and layers have `res` (1.35) pixels per unit, so the picture is 1080 x 1350. Code that touches raw pixels (fill, undo rectangles, `getImageData`) works in layer pixels (`layerPixels`); keep pixel values whole numbers.
- **Inline CSS in `index.html`.** All styles live in a single `<style>` block. Changes can have unexpected cascade effects — check mobile toolbar and desktop sidebar together.

## Native shell readiness

The plan is to keep improving the web app, then wrap it in a native shell for iOS and Android: native controls (SwiftUI / Jetpack Compose) around this canvas running in a web view. Keep changes compatible with that:

- **Engine apart from controls.** Put behaviour in functions the controls call (`setTool`, `undo`, `redo`, `generateScrawlface`, `setEyeStyles`, `saveToGallery`, ...), not in handlers that only work by clicking a particular HTML key. A native toolbar calls the same functions through `window.scrawlface` (end of `scrawl.js`), which also gives `appState()` and `onStateChange()`; when adding a feature, add it there too.
- **Browser-only features are swappable.** Each goes through one function a shell can replace: `exportPNG` (the picture for Share / Download), `haptic`, `showError`, `confirmLeave` / `confirmDelete`, and `dbRequest` (IndexedDB). Don't call `navigator.vibrate`, `alert` and the like directly.
- **Nothing remote.** p5.js and the wordmark fonts are bundled (`vendor/`, `fonts/`) and the app works offline; keep it that way: no CDN scripts, web fonts or other remote assets. The one approved exception: Vercel Web Analytics on the website (its same-site script, `/_vercel/insights/script.js`), skipped in canvas-only mode.
- **Canvas-only mode.** `index.html?embedded` (or an `embedded` class on `<html>`) hides the web controls and lets the canvas fill the window: that's what a shell loads. New UI should hide in that mode too.
- **Onboarding** (intro, ? help menu, coach marks, once-only tips) lives in the Onboarding section of `scrawl.js`; its state is in `localStorage` (`onboarding_completed`, `onboarding_skipped`, `onboarding_version_seen`, `tips_seen`). Raise `ONBOARDING_VERSION` only for an update worth showing everyone the intro again. A shell can drive it through `window.scrawlface` (`onboardingState`, `startTour`, `exploreFeatures`, `resetOnboarding`).
- **Analytics events.** Call `track(name, props)` for anything worth measuring (see `plans/analytics.md` for the list). The website sends events to Vercel Web Analytics as custom events; a shell forwards them from `window.scrawlface.onEvent` to its own analytics. Never put the drawing, image data or personal details in an event; add new events to the plan and `tests/analytics.js`.
- **The canvas fits any container.** It covers and masks itself to whatever box it's given (`fitCanvasToContainer`); keep it free of assumptions about the page around it.

## Success looks like

- A change ships without touching anything it didn't need to.
- The canvas feels responsive and snappy on Chrome mobile.
- Undo/redo behaves predictably across all tools.
- Code a new teammate could read without a walkthrough.