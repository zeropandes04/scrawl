# Feature Implementation Plan: My scrawlfaces (gallery)

**Overall Progress:** `95%` (left: test on a real phone)

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
- **Leaving edited work asks Save / Discard.** Starting a new scrawl (or opening another one from the gallery) after editing the current one asks the user to save or discard it, instead of today's "will be lost" confirm. Needs three choices, so it's a small native `<dialog>`, not `confirm()`.
- **Opening the app:**
  - Draft with unsaved changes → reopen it directly (that's the killed-tab case).
  - Otherwise → blank start, plus a row of recent saved scrawlfaces under the create button.

## Behaviour

### What a saved scrawlface holds
`id`, `updatedAt`, scrawl layer (PNG), paint layer (PNG), thumbnail (small JPEG, 320px), eye positions + scales, eye styles, lines shown/hidden, rotation.

The draft holds the same, plus `galleryId` (the entry it was saved to or opened from, if any) and `dirty` (changed since the last Save).

### Draft autosave
- Written ~1s after a change settles (stroke end, fill, erase, eye drag end, eye style, undo/redo, Clear, Hide/Show lines, Rotate), and immediately when the tab is hidden (`visibilitychange`).
- Only exists once a scrawl has been created (not on the blank start).

### Save
- Mobile: bottom sheet, Save section, after History (on a 360×640 phone the open sheet needs a short scroll to reach it). Desktop: sidebar, Save section, after History.
- Brief "Saved" confirmation on the key (LED / label), no dialog.
- Disabled when nothing changed since the last Save.

### New scrawl (and opening another from the gallery)
- If the current scrawlface was changed since it was created or last saved (paint, fill, erase, Clear, undo/redo, eye drag, eye style, Rotate, Hide/Show lines: everything a Save would store), show a dialog:
  - **Save** → save to the gallery (create or update its entry), then continue.
  - **Discard** → continue without saving.
  - **Cancel** (also the Esc key, or tapping outside) → stay on the current scrawlface.
- An untouched scrawl (just generated, or nothing changed since Save) → no dialog, continue straight away, so shuffling with New stays fast.
- Copy: "Save this scrawlface?" / "You've changed it since it was last saved." — wording to confirm.

### Gallery screen
- Opened from "My scrawlfaces" (sheet + sidebar) and "See all" in the recents row.
- Full-screen overlay; grid of thumbnails, newest `updatedAt` first; close button.
- Tap a tile → open it (Save / Discard dialog first if the current scrawlface was edited).
- Delete: **press and hold** a tile to start select mode with it picked, as in a photo gallery (a short buzz on Android). Taps then pick / unpick tiles; unpicking the last one leaves select mode; the header shows "n selected" with Cancel / Delete (n). No Select key. Moving the finger while holding (scrolling) doesn't select, and the phone's own image menu is suppressed. then Delete asks in a dialog ("Delete these n scrawlfaces?" / "This can't be undone." — Cancel, focused by default, or Delete in red) and removes them. No per-tile delete keys.
- Empty state: short line + the create button.

### Recents on the blank start
- Up to 4 latest saved thumbnails under the subtitle, plus "See all". Hidden when the gallery is empty.

## Tasks

- [x] 🟩 **Step 0: Fix the smoke test for the blank start**
  - [x] 🟩 `tests/smoke.js` waits for two eyes on load (line 37); since the blank start (PR #33) it must tap `#blank-cta-btn` first.

- [x] 🟩 **Step 1: Storage layer**
  - [x] 🟩 Small IndexedDB wrapper in `scrawl.js`: open DB, `saveEntry`, `getEntry`, `listEntries`, `deleteEntry`, `saveDraft`, `getDraft`.
  - [x] 🟩 Serialise / restore app state (layers → PNG blobs, eyes, styles, lines shown, rotation). Restoring clears undo/redo and leaves the blank-start state.

- [x] 🟩 **Step 2: Draft autosave + restore on open**
  - [x] 🟩 Mark the draft dirty and debounce-save on every change listed above; save on `visibilitychange`.
  - [x] 🟩 On load: reopen a dirty draft, otherwise blank start.

- [x] 🟩 **Step 3: Save + rename Export image**
  - [x] 🟩 Save key (sheet + sidebar): create or update the gallery entry, clear dirty, show "Saved".
  - [x] 🟩 Rename "Save image" → "Export image" (labels and titles).
  - [x] 🟩 Save / Discard / Cancel `<dialog>` (markup + CSS, flag layout impact) replacing the `confirm()` in `generateScrawlface()`; shown only when the draft is dirty.

- [x] 🟩 **Step 4: Gallery screen**
  - [x] 🟩 Overlay markup + CSS (flag layout impact: mobile sheet and desktop sidebar).
  - [x] 🟩 Grid, open (through the Save / Discard dialog when dirty), delete with confirm, empty state.

- [x] 🟩 **Step 5: Recents on the blank start**
  - [x] 🟩 Up to 4 thumbnails + "See all" under the subtitle.

- [x] 🟩 **Step 6: Verify**
  - [x] 🟩 Happy path: generate → eyes → doodle → undo/redo → Save → New → reopen from gallery → state matches.
  - [x] 🟩 Reload mid-drawing restores the draft; undo/redo empty after restore.
  - [x] 🟩 Undo edge cases after a restore (rapid actions, undo after fill, undo after eye drag).
  - [x] 🟩 Save twice updates one entry; delete removes it; recents and gallery update.
  - [x] 🟩 New after an edit: Save keeps it in the gallery, Discard drops it, Cancel leaves everything as it was (including undo/redo). New on an untouched scrawl shows no dialog.
  - [x] 🟩 360×640, Pixel 5 and desktop (1280×800, 1024×768) in headless Chromium.
  - [ ] 🟥 Chrome mobile on a real device.
  - [x] 🟩 Bump `scrawl.js?v=N` (now 26).

## Notes from the build
- Desktop sidebar at exactly 1024×768: the extra Save row makes it 27px taller than the panel, so it scrolls slightly (its overflow safety net). Fits at 800px tall and above.
- `tests/smoke.js` was fixed for the blank start and the transparent scrawl layer.

## Out of scope (for now)
- Save points / versions within one scrawlface (revisit if "undid too far" persists after this ships).
- Accounts, cloud sync, sharing gallery links.
- Naming, tagging or sorting scrawlfaces.
- Raising the 25-step undo limit or keeping redo after a new mark.
