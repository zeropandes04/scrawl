# Feature Implementation Plan

**Overall Progress:** `100%`

## TLDR
Fix the mobile bottom toolbar's inconsistent button sizing/shape/spacing, stop the "More" button from changing size when toggled, resolve the dead duplicate Rotate button, add Redo for mobile, and rebalance which controls live in the always-visible main bar vs. the expanded Controls menu.

## Critical Decisions
- **Shape**: main bar buttons become uniform rounded squares (not circles/pills) — fixes icon buttons (currently render ~48x48 circles) vs text/symbol buttons (currently render ~44x48 ovals) looking different.
- **Root cause fix**: `.icon-btn` (specificity 0,2,1) and `.mobile-tool-btn` (0,1,0) apply conflicting min-width/padding to the same 6 buttons. `.icon-btn` is only ever used alongside `.mobile-tool-btn`, so the fix is to delete the `.bottom-toolbar button.icon-btn` rule and fold `border-radius: 12px` (matching the existing `.mobile-control-btn` convention) into `.mobile-tool-btn`.
- **Main bar — Option A (chosen)**: stays at 5 buttons (Fill, Brush, Eraser, Undo, More) with more breathing room, rather than reshuffling to fill a 6th slot.
- **Rotate**: removed from the main bar. Repurpose the existing dead-duplicate `id="rotate-btn-mobile"` button already sitting in `.mobile-controls-grid` (give it a unique id and wire it to `rotateCanvas`) instead of deleting it and adding a new one.
- **Redo**: new button added to `.mobile-controls-grid`, wired to the existing null-guarded `redo` logic in `scrawl.js`.
- **Generate + Intensity**: stay grouped/adjacent in the expanded menu regardless of Controls grid reordering.
- **"More" button**: replace the inline `style.fontSize = '24px'` swap (⋯ → ×) with a CSS class toggle so its box stays a fixed size in both states.

## Tasks

- [x] 🟩 **Step 1: Fix main toolbar button CSS (size, shape, spacing)**
  - [x] 🟩 Delete the `.bottom-toolbar button.icon-btn` rule (confirmed unused elsewhere)
  - [x] 🟩 Add `border-radius: 12px` to `.mobile-tool-btn` (uniform rounded square at 48x48)
  - [x] 🟩 Remove the now-redundant `icon-btn` class from the 5 remaining main-bar button elements
  - [x] 🟩 Revisit `.mobile-toolbar-main` gap / `justify-content` — switched `space-between` → `center` and `gap: 12px` → `16px` for even, predictable "breathing room" with 5 buttons (outer `.bottom-toolbar` padding left as-is)

- [x] 🟩 **Step 2: Fix "More" button toggle shape**
  - [x] 🟩 In `setupMobileToolbar()`, removed the `toggleMenuBtn.style.fontSize = '24px'` / `''` swap entirely — `×` now renders at the same 15px size as `⋯` and the other symbol buttons, so the box never resizes

- [x] 🟩 **Step 3: Move Rotate from main bar to Controls grid**
  - [x] 🟩 Removed the `#rotate-btn-mobile` button from `.mobile-toolbar-main`
  - [x] 🟩 Renamed the existing dead-duplicate Rotate button in `.mobile-controls-grid` to `#rotate-btn-mobile-controls`
  - [x] 🟩 Rewired `select("#rotate-btn-mobile-controls").mousePressed(rotateCanvas)` in `scrawl.js`
  - [x] 🟩 Main bar is now: Fill, Brush, Eraser, Undo, More

- [x] 🟩 **Step 4: Add Redo for mobile in Controls grid**
  - [x] 🟩 Added `#redo-btn-mobile` button to `.mobile-controls-grid` (disabled by default, matching `#redo-btn`)
  - [x] 🟩 Confirmed the existing null-guarded `redo` wiring (lines ~93-96) and `updateUndoRedoButtons()` (lines ~1038-1044) pick it up automatically — no new JS logic needed

- [x] 🟩 **Step 5: Reorganize Controls grid**
  - [x] 🟩 New 2-column / 3-row layout: Generate | Rotate, Toggle Scrawl | Move Eyes, Redo | Clear
  - [x] 🟩 Intensity slider section remains directly adjacent to the Controls grid (Generate) — unchanged

- [x] 🟩 **Step 6: Test on mobile (real small viewport, not DevTools resize)**
  - [x] 🟩 Main bar: 5 buttons render as uniform 48x48 rounded squares (12px radius), centered with even 16px gaps
  - [x] 🟩 "More" button stays 48x48 in both ⋯ and × states (verified via measurement before/after toggle)
  - [x] 🟩 Controls grid: Rotate, Redo, Generate, Toggle Scrawl, Move Eyes, Clear all work — verified rotation changes, scrawl visibility toggles (with active-state highlight), new scrawl generation, drawing, and eye dragging
  - [x] 🟩 Undo (main bar) / Redo (Controls) enable-disable state stays in sync — verified across 10+ transitions
  - [x] 🟩 Undo/redo edge cases: rapid undo/redo x2, undo after bucket fill, undo after eye drag (eye drag correctly excluded from history) — all correct
  - [x] 🟩 Full happy path: generate scrawl → place/move eyes → doodle → undo/redo — confirmed working at 390x844 viewport
