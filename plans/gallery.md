# Feature Implementation Plan: My scrawlfaces (gallery)

**Overall Progress:** `0%`

## TLDR
Mobile users asked to "save and go back if I mess up" and to "see the ones I created". Add a gallery: users tap **Save** to keep a scrawlface, can reopen any saved one to carry on, and see their recent ones on the blank start. A single hidden **draft** keeps the scrawlface in progress safe across reloads and killed tabs, without filling the gallery with abandoned work.

## Feedback this answers
- "I want to be able to save and go back if I mess up" → Save, then reopen the saved one to get back to that state.
- "I'd be nice to see the ones I created" → gallery + recents on the blank start.
- Losing work when Chrome kills a background tab → hidden draft.

## Critical Decisions
- **Gallery = explicit Save only.** Creating a scrawl is cheap and people shuffle with New, so autosaving everything would fill the gallery with abandoned starts.
- **One hidden draft, outside the gallery.** The scrawlface in progress is autosaved to a single slot. It is restored after a reload or killed tab, and overwritten when a new scrawlface is started. It never shows as a gallery tile.
- **Save overwrites its own entry.** The first Save creates a gallery entry; later Saves on the same scrawlface update it. Reopening the entry restores the last saved state, which is the "go back to where I saved" path. (Separate save points / versions: skipped for now, see Out of scope.)
- **Undo history is not stored.** A full history is up to ~70MB. Opening a saved scrawlface or restoring the draft starts with empty undo/redo.
- **Storage: IndexedDB, this browser only.** No accounts, nothing uploaded. Clearing site data deletes the gallery; it doesn't follow the user to another device. If IndexedDB is unavailable, Save and the gallery are hidden and the app works as today.
- **Layers stored as PNG blobs**, not scrawl segments: one format for the scrawl and the paint, and nothing to re-animate on open.
- **"Save image" is renamed "Export image"** (PNG download), so "Save" can mean "save to gallery".
- **Entry points (mobile): bottom sheet + blank start.** No change to the header or the tool row.
- **Opening the app:**
  - Draft with unsaved changes → reopen it directly (that's the killed-tab case).
  - Otherwise → blank start, plus a row of recent saved scrawlfaces under the create button.

## Behaviour

### What a saved scrawlface holds
`id`, `createdAt`, `updatedAt`, scrawl layer (PNG), paint layer (PNG), thumbnail (small JPEG, ~240px), eye positions + scales, eye styles, lines shown/hidden, rotation.

The draft holds the same, plus `galleryId` (the entry it was saved to or opened from, if any) and `dirty` (changed since the last Save).

### Draft autosave
- Written ~1s after a change settles (stroke end, fill, erase, eye drag end, eye style, undo/redo, Clear, Hide/Show lines, Rotate), and immediately when the tab is hidden (`visibilitychange`).
- Only exists once a scrawl has been created (not on the blank start).

### Save
- Mobile: bottom sheet, Save section. Desktop: sidebar, Save section.
- Brief "Saved" confirmation on the key (LED / label), no dialog.
- Disabled when nothing changed since the last Save.

### New scrawl
- If the draft has unsaved changes: confirm "Start a new scrawl? Unsaved changes will be lost." (as today).
- Otherwise: no confirm.

### Gallery screen
- Opened from "My scrawlfaces" (sheet + sidebar) and "See all" in the recents row.
- Full-screen overlay; grid of thumbnails, newest `updatedAt` first; close button.
- Tap a tile → open it (confirm first if the current draft has unsaved changes).
- ⋯ on a tile → Delete, with a confirm.
- Empty state: short line + the create button.

### Recents on the blank start
- Up to 4 latest saved thumbnails under the subtitle, plus "See all". Hidden when the gallery is empty.

## Tasks

- [ ] 🟥 **Step 0: Fix the smoke test for the blank start**
  - [ ] 🟥 `tests/smoke.js` waits for two eyes on load (line 37); since the blank start (PR #33) it must tap `#blank-cta-btn` first.

- [ ] 🟥 **Step 1: Storage layer**
  - [ ] 🟥 Small IndexedDB wrapper in `scrawl.js`: open DB, `saveEntry`, `getEntry`, `listEntries`, `deleteEntry`, `saveDraft`, `getDraft`.
  - [ ] 🟥 Serialise / restore app state (layers → PNG blobs, eyes, styles, lines shown, rotation). Restoring clears undo/redo and leaves the blank-start state.

- [ ] 🟥 **Step 2: Draft autosave + restore on open**
  - [ ] 🟥 Mark the draft dirty and debounce-save on every change listed above; save on `visibilitychange`.
  - [ ] 🟥 On load: reopen a dirty draft, otherwise blank start.

- [ ] 🟥 **Step 3: Save + rename Export image**
  - [ ] 🟥 Save key (sheet + sidebar): create or update the gallery entry, clear dirty, show "Saved".
  - [ ] 🟥 Rename "Save image" → "Export image" (labels and titles).
  - [ ] 🟥 New-scrawl confirm only when the draft is dirty.

- [ ] 🟥 **Step 4: Gallery screen**
  - [ ] 🟥 Overlay markup + CSS (flag layout impact: mobile sheet and desktop sidebar).
  - [ ] 🟥 Grid, open, delete with confirm, empty state.

- [ ] 🟥 **Step 5: Recents on the blank start**
  - [ ] 🟥 Up to 4 thumbnails + "See all" under the subtitle.

- [ ] 🟥 **Step 6: Verify**
  - [ ] 🟥 Happy path: generate → eyes → doodle → undo/redo → Save → New → reopen from gallery → state matches.
  - [ ] 🟥 Reload mid-drawing restores the draft; undo/redo empty after restore.
  - [ ] 🟥 Undo edge cases after a restore (rapid actions, undo after fill, undo after eye drag).
  - [ ] 🟥 Save twice updates one entry; delete removes it; recents and gallery update.
  - [ ] 🟥 360×640 and desktop; Chrome mobile on a real device.
  - [ ] 🟥 Bump `scrawl.js?v=N`.

## Out of scope (for now)
- Save points / versions within one scrawlface (revisit if "undid too far" persists after this ships).
- Accounts, cloud sync, sharing gallery links.
- Naming, tagging or sorting scrawlfaces.
- Raising the 25-step undo limit or keeping redo after a new mark.
