# Analytics events

**Status:** built. Events are named in `track()` calls in `scrawl.js` (section "Analytics events"); tested by `tests/analytics.js`.

## How it works
- `track(name, props)` records an event. Events go to listeners, and the last 50 are kept for checking (`window.scrawlface.recentEvents()`).
- **The website** sends them to **Vercel Web Analytics**: `scrawl.js` adds Vercel's script (`/_vercel/insights/script.js`, served by Vercel itself), which counts page views, and forwards each event as a custom event (`va('event', { name, data })`). Lists become comma-separated text, since custom event values must be plain. The script exists only where Vercel hosts the site; elsewhere (e.g. GitHub Pages) it fails to load and nothing is sent. Custom events are only recorded on Vercel plans that include them; page views on every plan. Web Analytics has to be switched on for the project in the Vercel dashboard.
- **Umami** (cloud.umami.is) also gets them, on **scrawlface.app only** (not on GitHub Pages, local copies, in tests or in a native shell, so those don't count): `scrawl.js` adds Umami's script with the website ID, which counts page views, and sends each event with `umami.track(name, data)` (the same plain values). Events from before the script has loaded wait and go once it has (`startUmami`). Umami uses no cookies.
- **A native shell** listens with `window.scrawlface.onEvent(fn)` (returns a function that stops listening) and forwards events to its own analytics. Canvas-only mode loads no Vercel script.
- **Privacy:** no drawing, image data or personal details in any event. Vercel Web Analytics uses no cookies.

## Every event carries
| Property | Value |
|---|---|
| `platform` | `web`, or `shell` in canvas-only mode (the shell can add `ios` / `android`) |
| `app_version` | the `scrawl.js?v=N` number |
| `onboarding_version` | `ONBOARDING_VERSION` |
| `time` | on the event itself: milliseconds since 1970 |

## Core
| Event | When | Properties |
|---|---|---|
| `scribble_generated` | A new scribble appears | `source`: `blank_start`, `sidebar` (desktop New scribble), `drawer` (phone drawer's New scribble), `canvas_button` (the floating New key on phones), `key_n`, `my_scrawls`, `tour`, `other` (shell) · `loops` |
| `scrawlface_saved` | A save succeeds | `trigger`: `button`, `auto` (5-minute autosave), `leave_prompt`, `my_scrawls` · `first_save` · `seconds_since_generated` (null for a reopened or restored one) · `tools_used` · `strokes` · `fills` |
| `scrawlface_shared` | The share sheet sends it | `from`: `canvas` |
| `share_cancelled` | The share sheet is dismissed | `from`: `canvas` |
| `scrawlface_downloaded` | The PNG is downloaded | `from`: `canvas` |
| `tool_used` | First use of a tool on this scrawlface (a stroke, a fill, an eye drag) | `tool`: `brush`, `fill`, `eraser`, `eyes` |
| `drawing_started` | The first paint (Brush, Fill, Eraser) on a scrawlface | `tool` · `seconds_since_generated` |
| `drawing_finished` | Done with a painted scrawlface: kept it, or moved on after 3+ strokes / fills (once per scrawlface; see `plans/metrics.md`) | `how`: `saved`, `autosaved`, `shared`, `downloaded`, `new`, `opened_another`, `left` · `paint_actions` · `seconds_drawing` · `tools_used` |

## Playing with it
| Event | When | Properties |
|---|---|---|
| `eye_style_changed` | An eye set is picked, or Mix | `style`: the set's name, or `mix` |
| `canvas_rotated` | Rotate | `rotation` (0, 90, 180, 270) |
| `lines_hidden` | Hide / Show lines | `hidden` |
| `paint_hidden` | Hide / Show paint | `hidden` |
| `canvas_zoomed` | A pinch starts (two fingers, or a trackpad pinch / two-finger move on desktop) | `input`: `touch`, `trackpad` |
| `lines_peeked` | Hold still to peek under the lines (touch, or a trackpad / mouse press) | (none) |
| `undo_used` / `redo_used` | Only when something was undone / redone | (none) |
| `clear_used` | Clear removed paint | (none) |

## My Scrawls and leaving work
| Event | When | Properties |
|---|---|---|
| `my_scrawls_opened` | My Scrawls opens | `count` (saved scrawlfaces) |
| `example_opened` | The example scrawlface (empty My Scrawls) is opened as a copy | (none) |
| `scrawlface_reopened` | A saved one is opened onto the canvas | (none) |
| `scrawlface_deleted` | Delete confirmed | `count` |
| `leave_prompt_answered` | The Save / Discard prompt is answered | `answer`: `save`, `discard`, `cancel` |
| `draft_restored` | Last visit's unsaved work comes back | (none) |

## App and errors
| Event | When | Properties |
|---|---|---|
| `wordmark_changed` | The wordmark takes another typeface: tapped, or back after a 30-minute break | `trigger`: `tap`, `return`, `other` (shell) · `font` |
| `app_opened` | Every load | `first_open` · `days_since_last` (null the first time) |
| `returning_visit` | Back after 30+ minutes away (a load or returning to an open page; not a reload), from a device seen before | `days_since_first` · `days_since_last` · `visit_number` |
| `error` | An error message is shown | `where`: `save`, `open` |

## Onboarding
The three stored states (`onboarding_completed`, `onboarding_skipped`, `onboarding_version_seen`) stay as they are; these events add where people drop off.

| Event | When | Properties |
|---|---|---|
| `onboarding_started` | The product tour opens | `source`: `first_launch`, `help_menu`, `other` (shell) |
| `onboarding_completed` | Its last key | (none) |
| `onboarding_skipped` | Skip or Esc | `at_step` (1–3) |
| `explore_features_started` | Explore features opens | (none) |
| `explore_features_completed` | Done on its last step | (none) |
| `explore_features_ended` | End tour or Esc part way | `at_step` |
| `tip_shown` | A one-off tip appears | `tip_id`: `drag-eyes` (the first scrawl's tip), `fill`, `gestures`, `save`, `help-key` |
| `tip_closed` | It goes away | `tip_id` · `via`: `button`, `escape`, `dismissed` (a press elsewhere, or the app putting it away) |

## What it measures
- **Activation:** `app_opened` → `onboarding_completed` / `_skipped` → `scribble_generated` → `tool_used` → `scrawlface_saved` / `_shared` / `_downloaded`.
- **Engagement:** scribbles per visit, `seconds_since_generated` at save, which tools get used.
- **Onboarding impact:** completed versus skipped, compared on saves and shares; `at_step` shows where people leave.
