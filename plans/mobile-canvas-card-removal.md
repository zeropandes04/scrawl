# Feature Implementation Plan

**Overall Progress:** `100%`

## TLDR
On mobile (≤768px), the canvas sits inside a white "card" (background, rounded corners, shadow, margins/padding) and below a redundant controls row. Strip that framing and the duplicate controls so the canvas fills the available screen space, edge-to-edge.

## Critical Decisions
- Break `.canvas-section` out of `.container`'s side padding via negative margins (`margin: 0 -16px ...`) on mobile, rather than zeroing `.container` padding globally — keeps header/example-section/footer padding intact.
- Keep `.canvas-section`'s bottom margin (80px) on mobile so the canvas doesn't render underneath the fixed `.bottom-toolbar`.
- Hide `.canvas-controls` (Generate button + Intensity slider) on mobile — `.bottom-toolbar` already duplicates these (`#generate-btn-mobile`, `#intensity-slider-mobile`), and removing this row is necessary to let the canvas actually claim the freed-up vertical space.

## Tasks

- [x] 🟩 **Step 1: Strip card styling from `.canvas-section` on mobile**
  - [x] 🟩 In `@media (max-width: 768px)`, override `.canvas-section`: `background: transparent`, `border-radius: 0`, `box-shadow: none`, `margin: 0 -16px 80px`

- [x] 🟩 **Step 2: Reduce `.canvas-area` padding on mobile**
  - [x] 🟩 Set `.canvas-area` padding to `8px` in `@media (max-width: 768px)`. Removed the now-redundant `480px` override (was `20px`, would have un-done the 8px) so the value cascades cleanly.

- [x] 🟩 **Step 3: Remove canvas rounding/shadow on mobile**
  - [x] 🟩 In `@media (max-width: 768px)`, override `#scrawl-container canvas`: `border-radius: 0`, `box-shadow: none`

- [x] 🟩 **Step 4: Hide redundant `.canvas-controls` row on mobile**
  - [x] 🟩 In `@media (max-width: 768px)`, added `.canvas-controls { display: none; }`

- [x] 🟩 **Step 5: Verify**
  - [x] 🟩 Checked at 390px width (Playwright screenshot): canvas fills width edge-to-edge, no card visible, no overlap with bottom toolbar, no console errors
  - [x] 🟩 Confirmed desktop (1200px) layout unchanged — card, sidebar, and canvas controls render as before
