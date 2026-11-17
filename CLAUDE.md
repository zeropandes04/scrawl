# Scrawlface — Project Context

Single-page pareidolia art generator: draw a random scrawl, place "eyes" on it, doodle on top.

@CLAUDE.local.md <!-- local secrets, not committed -->

## Stack

- Frontend: Vanilla HTML/CSS/JS + p5.js (CDN, v1.4.0)
- Hosting: static site — no build step, no package manager, no framework

## Architecture

- `index.html` — markup + all CSS (inline `<style>`), desktop sidebar + mobile bottom toolbar
- `scrawl.js` — all app logic: canvas setup, scrawl generation (bezier curves), brush/eraser/bucket tools, eye placement & dragging, undo/redo (memento pattern), mobile toolbar wiring
- `icons/` — toolbar PNG icons (eraser, eye, paint-rollers, paintbrush)

## Hard rules

- No build step, no package manager, no framework — ever.
- No new CDN library without explicit approval. Additions are case-by-case, not default.
- Never modify CSS without flagging potential layout impact.
- Never refactor unrelated files when fixing a specific issue.
- Never introduce a new abstraction for a one-off use case.

## Quality bar

- Browser tests: `tests/smoke.js` (generate, eyes, doodle, undo/redo, fill, export) and `tests/gallery.js` (Save, draft, My Scrawls). See the header of `tests/smoke.js` to run them.

- Test on Chrome mobile after every change — that is the primary target.
- "No regressions" means manually walking the happy path: generate scrawl → place eyes → doodle → undo/redo.
- Every UI change must be verified on a small viewport before it's done.
- If a change touches the undo/redo stack, treat it as high risk and test edge cases explicitly (rapid actions, undo after bucket fill, undo after eye drag).

## Known gotchas

- **Undo/redo is the most fragile part.** The memento pattern implementation in `scrawl.js` is the most likely source of regressions. Approach changes here carefully.
- **Touch events on mobile canvas are risky.** p5.js touch handling can conflict with default browser scroll/zoom behaviour. Test on a real small viewport, not just DevTools resize.
- **Bump the script version.** `index.html` loads `scrawl.js?v=N`. Increase `N` in every change that touches `scrawl.js`, otherwise browsers can pair the new page with a cached old script (this showed up as a stretched canvas on mobile).
- **Units vs pixels.** Logic works in units: the picture frame is 800 x 1000 units around the 800 x 800 scrawl square, and the paint layer is bigger so it covers the frame at any rotation. The canvas and layers have `res` (1.35) pixels per unit, so the picture is 1080 x 1350. Code that touches raw pixels (fill, undo rectangles, `getImageData`) works in layer pixels (`layerPixels`); keep pixel values whole numbers.
- **Inline CSS in `index.html`.** All styles live in a single `<style>` block. Changes can have unexpected cascade effects — check mobile toolbar and desktop sidebar together.

## Success looks like

- A change ships without touching anything it didn't need to.
- The canvas feels responsive and snappy on Chrome mobile.
- Undo/redo behaves predictably across all tools.
- Code a new teammate could read without a walkthrough.