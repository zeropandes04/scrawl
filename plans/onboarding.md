# Feature Implementation Plan: Onboarding (Understand → Discover → Learn → Experience)

**Overall Progress:** `100%` (all six steps done; tests in `tests/onboarding.js`)

## TLDR
Add onboarding as a learning resource, not just a first-launch carousel: a short **intro** (4 screens) on first launch, a persistent **help key** to replay it or **explore the features** with tooltips, and **contextual tips** that appear once, at the moment a feature becomes relevant. Progress is stored locally (three states, versioned) so the intro shows automatically only once per version.

## Critical Decisions
- **Four intro screens, one per principle:**
  1. **Understand: "Find faces in scribbles."** Scrawlface draws a random scribble; your brain finds a face in it (pareidolia).
  2. **Discover: "Place the eyes."** Drag the eyes to where the face is; pick an eye style or tap Mix.
  3. **Learn: "Doodle on top."** Brush, Fill and Eraser bring the face out; Undo anything.
  4. **Experience: "Keep and share."** Save to My Scrawls, share the picture. Ends on **Create your first scrawlface**.
- **Skip on every screen; Back / Next; dots for progress.** Completing or skipping both stop the automatic showing.
- **Illustrations drawn by the app itself**: each screen shows a small live example made with the real engine: a scrawl drawing itself in, eyes dropping onto it, a fill and a stroke appearing, the fanned pile of prints. They match the app exactly and need no image files.
- **Help key in the header, next to My Scrawls**, on every screen size: a **?** icon key (icon only, 44pt). It opens a small menu with **Product tour** (replays the intro) and **Explore features** (tooltips).
- **Explore features = coach marks on the real controls**: a short sequence of tooltips, each pointing at a real control, with Next / Done and a step count:
  - New scrawl and Loops · the tools · eye styles and Mix · Undo / Redo · My Scrawls and Save · (touch) pinch to zoom / rotate, hold to peek under the lines.
  - Desktop points at the sidebar, phones at the bottom bar (opening the drawer where needed).
- **Contextual tips, each shown once** (stored, so never repeated), small and dismissible, anchored to what they explain:
  - First scrawl on the canvas: "Drag the eyes to where you see a face."
  - First time on Brush (touch): "Pinch to zoom and turn · hold still to peek under the lines."
  - First time on Fill: "Tap an area closed in by lines."
  - First unsaved change worth keeping (e.g. after a few strokes): "Save to My Scrawls to keep it."
- **Empty states**: the blank start and the empty My Scrawls already guide to the next step; their copy gets a pass to match the intro's wording.
- **Tracking: local only** (no analytics, nothing remote, per CLAUDE.md): `localStorage` keys
  - `onboarding_completed` (the version completed), `onboarding_skipped` (the version skipped), `onboarding_version_seen` (highest intro version shown),
  - plus `tips_seen` (list of contextual tips already shown).
  - `ONBOARDING_VERSION = 1` in `scrawl.js`; raising it shows the intro once more to everyone (for a meaningful update).
  - Exposed to a native shell through `window.scrawlface` (state + "start tour" / "explore" / "reset"), so a shell can show its own native onboarding instead and keep the same state.
- **Canvas-only mode** (`?embedded`): no intro, help key or tips (the shell does its own).
- **No new library.** A `<dialog>` for the intro (like the Save / Discard prompt) and one small tooltip element reused for coach marks and tips.

## Tasks

- [x] 🟩 **Step 1: State and versioning**
  - [x] 🟩 `onboardingState()` / `markOnboarding('completed' | 'skipped')`, `tipSeen(id)` / `markTipSeen(id)`, versioned as above; storage failures fall back to "don't show"
  - [x] 🟩 Auto-show rule: on load, if `onboarding_version_seen < ONBOARDING_VERSION` (and not embedded)

- [x] 🟩 **Step 2: Intro (4 screens)**
  - [x] 🟩 `<dialog>` with the four screens, dots, Back / Next, Skip; last screen's key creates the first scrawlface
  - [x] 🟩 Live illustrations drawn by the engine
  - [x] 🟩 Phone: full-screen sheet; desktop: centred card; respects reduced motion; keyboard (←/→, Esc = skip)

- [x] 🟩 **Step 3: Help key and menu**
  - [x] 🟩 **?** key in the header (both layouts; fits next to My Scrawls on a 320px phone)
  - [x] 🟩 Menu: Product tour, Explore features

- [x] 🟩 **Step 4: Explore features (coach marks)**
  - [x] 🟩 One tooltip element with an arrow, positioned at the target control, Next / Done, step count, Esc
  - [x] 🟩 Steps for desktop (sidebar) and phone (bottom bar / drawer)

- [x] 🟩 **Step 5: Contextual tips and empty states**
  - [x] 🟩 The four once-only tips above, reusing the tooltip element
  - [x] 🟩 Copy pass on the blank start and empty My Scrawls (already matched the intro's wording; unchanged)

- [x] 🟩 **Step 6: Shell API and tests**
  - [x] 🟩 `window.scrawlface`: onboarding state, start tour, explore, reset
  - [x] 🟩 Tests: first launch shows the intro; Skip / Done stop it; it stays away after reload; a version bump shows it again; the help menu replays it; coach marks step through and end; each tip shows once; nothing shows in `?embedded`

## Risks
- **Header space on small phones**: a third item next to the wordmark and My Scrawls. My Scrawls already drops its label under 360px; the ? key is icon-only.
- **Coach marks over a changing layout** (drawer, rotation, resize): positions are recomputed per step and on resize.
- **Not annoying**: the intro is at most once per version, tips once each, all dismissible; nothing blocks drawing.

## Decisions (answered)
1. **Existing users** (made a scrawlface before this shipped): no intro; a one-time tip points at the new ? key.
2. **Illustrations**: live, drawn by the app's own engine.
3. **Help key icon**: ?.

## Revision 2: an invitation to discover, not a drawing tutorial
Promise: *boost your imagination by discovering the unexpected in the ordinary.* The intro avoids presenting Scrawlface as a drawing app.
- [x] 🟩 **Three screens + a first experience** (step labels `01 · what is it?` …):
  1. "There's more than meets the eye.": a scribble draws in, then eyes pop in: it was someone all along.
  2. "Every scribble holds a possibility.": the pile of three finished discoveries.
  3. "Look again. What do you see?": the three steps as a list; the illustration loops through them (scribble → eyes → fill and mouth), a new scribble each round, and the step it's on is marked.
  4. "Let's find something unexpected.": scribble after scribble draws in, no eyes. CTA **Start discovering** (Done when replayed over a scrawlface).
- [x] 🟩 **Interactive first scribble** (`findingFace`): the scribble the intro creates comes without eyes, and a tip asks "Can you spot a face? Tap where you see one." The tap puts the eyes there (a change for Save; not an undo step, like an eye drag), then "Found one!" points at them (key: Let's go!). **Surprise me!**, choosing another tool, Save or Share puts the eyes in their random spots instead.
- [x] 🟩 Tour copy: Brush, Fill and Eraser "bring what you found to life".
- The reference images in the brief are not used: everything is drawn live by the app (nothing remote, no third-party art).
- [x] 🟩 **Tone pass**: playful, curious, slightly mischievous; short sentences, fewer instructions, and "imagination" left for the experience to show rather than the copy to say.
- [x] 🟩 **Copywriter pass** (all of it, intro to tour). Principles: playful, not childish; concise, not cryptic; conversational, not instructional. Exclamation marks only for the interactive moments. Terms: scribble (the random drawing), scrawlface (the finished piece), discover / spot / find, bring it to life / make it yours, My Scrawls, and the controls' exact names.
  - Tour steps now have a short title over their text (`coach-title`).
- [x] 🟩 **Product tour, three steps** (menu: "Product tour · Meet Scrawlface"), each with its own key: 01 · Look closer, "Train your imagination." (Let's look) · 02 · Make it yours, "Every scribble holds a possibility." (Show me) · 03 · Find something unexpected, "Your first scribble is waiting." (Surprise me!, or Done when replayed over a scrawlface). The pile of prints and the list of steps are gone.
  - First scribble: "Can you spot a face?" Tapping the canvas puts the eyes there: "Found one! …" (Got it). Show me puts them in for you: "There's more than meets the eye. Move the eyes to make it yours." (Let's go! closes it). A press anywhere outside a one-off tip closes it too.
