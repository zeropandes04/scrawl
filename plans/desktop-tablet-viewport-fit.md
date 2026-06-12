# Feature Implementation Plan

**Overall Progress:** `100%`

## TLDR
On desktop/tablet (>768px), the page overflows the viewport by 280-425px across common sizes (measured at 1024×768, 1280×800, 1440×900, 900×700), forcing scroll. Restructure the layout so everything fits within `100vh` down to a 1024×768 floor: shrink the header, drop the empty footer, move the Generate/Intensity controls and scrawl counter into the sidebar column, and change canvas sizing from width-driven to bounded-by-min(width, height).

## Critical Decisions
- **New `@media (min-width: 769px)` block** drives the whole restructure. `.container` becomes `height: 100vh; overflow-y: auto; display: flex; flex-direction: column;` — `overflow-y: auto` (not `hidden`) is a safety net: content fits without scrolling at ≥768px viewport height (the design floor), but isn't clipped if a window is shorter.
- **Canvas sizing** changes from "scale to container width" (`max-width:100%; height:auto`) to "scale to fit within the smaller of available width/height" (`max-width:100%; max-height:100%; width:auto; height:auto`), via a `flex:1; min-height:0` chain (`main` → `.canvas-section` → `.canvas-area` → `#scrawl-container`). The `min-height:0`/`min-width:0` chain is scoped to `>768px` only; the canvas CSS addition (`max-height:100%; width:auto`) is global but a no-op on mobile (parent height is intrinsic there).
- **`.canvas-controls` (Generate + Intensity) moves in the DOM** into `.sidebar` as its first `.sidebar-section`. Safe for mobile — `.sidebar{display:none}` already hides it there, making the existing `.canvas-controls{display:none}` mobile override redundant (removed). Requires removing the inline `min-width:280px` on `#generate-btn` and restyling for a narrow column.
- **`.scrawl-counter` stays in its current DOM position** (sibling of `.canvas-section` in `main`) — no DOM move, so mobile's normal-flow placement is untouched. For `>768px`, `main` becomes a grid (`1fr 280px` columns / `1fr auto` rows); `.canvas-section` spans `grid-column: 1/-1; grid-row: 1`, `.scrawl-counter` sits at `grid-column: 2; grid-row: 2` and is restyled to visually read as a continuation of the sidebar.
- **Header shrink + footer removal** for `>768px` are simple additive overrides in the new media query (font-size/padding reductions, `footer{display:none}`).
- Exact spacing/font-size values are tuned during execution against the 1024×768 floor via Playwright screenshots, not pinned in advance.
- **Canvas sizing implementation**: `max-width/max-height: auto` did not preserve the 1:1 ratio for `<canvas>` (browser sized each axis independently against its own constraint, producing a stretched rectangle). Fixed with `#scrawl-container { flex: 1; min-height: 0; min-width: 0; width: 100% }` + `canvas { width: 100%; height: 100% !important; object-fit: contain }` — the container fills the available (non-square) box, and `object-fit: contain` keeps the square scrawl undistorted and centered within it.
- **Sidebar compaction (added during execution)**: relocating the controls into the sidebar made its content (758px) taller than the available height (597px at 1024×768), clipping History/Download via `.canvas-section`'s `overflow: hidden` — a regression worse than scrolling. Fixed by tightening `.sidebar` padding/gap, `.sidebar-section` gap, and switching `.color-swatches-palette` to 8 columns (2 rows instead of 3, ~60px saved). `.sidebar { overflow-y: auto }` remains as a safety net. Result: sidebar content fits exactly (0px overflow) at both 1024×768 and 1440×900.

## Tasks

- [x] 🟩 **Step 1: Viewport-constrained shell**
  - [x] 🟩 Added `@media (min-width: 769px)`: `.container { height: 100vh; overflow-y: auto; display: flex; flex-direction: column; }`
  - [x] 🟩 `main { flex: 1; min-height: 0; }`
  - [x] 🟩 Overrode `.canvas-section { min-height: 0; margin: 16px 0 0; }` (replaces the `min-height: 600px` / `margin: 40px 0` that would otherwise force overflow); also squared its bottom corners (`border-radius: 18px 18px 0 0`) so the scrawl-counter reads as a seamless continuation

- [x] 🟩 **Step 2: Shrink header**
  - [x] 🟩 `header { padding: 16px 0 8px; }`, `h1 { font-size: 28px; margin-bottom: 2px; }`, `.subtitle { font-size: 14px; margin-top: 2px; }`

- [x] 🟩 **Step 3: Hide empty footer**
  - [x] 🟩 `footer { display: none; }` in the new media query (mobile footer untouched)

- [x] 🟩 **Step 4: Relocate canvas-controls into the sidebar**
  - [x] 🟩 Moved the `.canvas-controls` markup (Generate button + Intensity control-group) from `.canvas-area` to be the first child of `aside.sidebar`
  - [x] 🟩 Removed the inline `style="min-width: 280px;"` from `#generate-btn` (sidebar's `.sidebar .cta-button { width: 100% }` now governs its width)
  - [x] 🟩 Added `>768px`-scoped `.canvas-controls { flex-direction: column; align-items: stretch; gap: 12px; }` so it stacks and fills the sidebar width
  - [x] 🟩 Removed the now-redundant `.canvas-controls { display: none; }` rule from `@media (max-width: 768px)` — hidden "for free" via `.sidebar { display: none }` on mobile

- [x] 🟩 **Step 5: Canvas sizing — bound by min(width, height)**
  - [x] 🟩 In the new media query: `.canvas-area { min-height: 0; min-width: 0; }` and `#scrawl-container { flex: 1; min-height: 0; min-width: 0; width: 100%; }`
  - [x] 🟩 On `#scrawl-container canvas` (base rule), added `max-height: 100%; width: auto;` alongside the existing `max-width: 100%; height: auto !important;` — no-op on mobile since the parent height is intrinsic there

- [x] 🟩 **Step 6: Reflow scrawl-counter into the sidebar column**
  - [x] 🟩 In the new media query: `main { display: grid; grid-template-columns: 1fr 280px; grid-template-rows: 1fr auto; }`
  - [x] 🟩 `.canvas-section { grid-column: 1 / -1; grid-row: 1; }`
  - [x] 🟩 `.scrawl-counter { grid-column: 2; grid-row: 2; }`, restyled (background `#f5f5f7`, matching left border, bottom-rounded corners, `16px 24px` padding) to read as a continuation of `.sidebar`

- [x] 🟩 **Step 7: Verify**
  - [x] 🟩 Playwright screenshots at 1024×768, 1280×800, 1440×900, 900×700 — `scrollHeight === innerHeight` (0px overflow) at all four; sidebar `scrollHeight === clientHeight` (0px) at 1024×768 and 1440×900 — all sections (controls, tools, colours, view, history, download, counter) visible without scrolling
  - [x] 🟩 Re-checked mobile (390×844) — canvas still fills the screen, scrawl-counter still visible in normal flow below it, bottom toolbar unaffected
  - [x] 🟩 No new console errors — the only console error is the pre-existing `example-scrawlface.png` 404 (unrelated, already present before this change)
