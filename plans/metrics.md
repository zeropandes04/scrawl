# Is Scrawlface worth investing in? What to measure

The question: is this a practice people come back to, or a novelty randomiser? Events are in `plans/analytics.md`. **Umami** (scrawlface.app, free plan) gets the funnel events below; **Vercel Web Analytics** gets every event (custom events need a Vercel plan that includes them). Umami shows custom events with their properties (Events), visit duration and bounce rate (Overview), and returning visitors (Reports → Retention).

## The funnel
`scribble_generated` → `drawing_started` → `drawing_finished` → `scrawlface_saved` / `scrawlface_shared` / `scrawlface_downloaded`, and later `returning_visit`.

| Event | What it means here |
|---|---|
| `scribble_generated` | A new scribble (with `source`: which button) |
| `drawing_started` | The first paint (Brush, Fill or Eraser) on a scrawlface: they're making something (`tool`, `seconds_since_generated`) |
| `drawing_finished` | Done with a scrawlface they painted: they **kept** it (`how`: `saved`, `autosaved`, `shared`, `downloaded`), or **moved on** after real work (`new`, `opened_another`, `left` the page) with at least 3 strokes / fills. Once per scrawlface. Also `paint_actions`, `seconds_drawing`, `tools_used` |
| `scrawlface_saved` | Saved to My Scrawls (`trigger`: `button` is the deliberate one; `auto` is the 5-minute autosave) |
| `scrawlface_shared` · `scrawlface_downloaded` | The picture left the app |
| `returning_visit` | Back after 30+ minutes away (not a reload), from a device seen before: `days_since_first`, `days_since_last`, `visit_number`. Counted on the device (localStorage), so it works whatever the analytics tool does with visitor IDs |

The "real work" bar (3 strokes / fills) is `finishedPaintActions` in `scrawl.js`; the visit gap (30 minutes) is `visitGapMs`.

## Signals that we're onto something
| Signal | Target | How to read it |
|---|---|---|
| **Finishing is activation** | 40%+ of visitors finish at least one | Unique visitors with `drawing_finished` ÷ unique visitors (Umami: Events → `drawing_finished`, visitors) |
| **They save** ("this mattered to me") | A healthy share of finished drawings saved | `drawing_finished` with `how` = `saved` (deliberate) ÷ all `drawing_finished`; also `scrawlface_saved` with `trigger` = `button` |
| **They come back unprompted** (no notifications, so pure intent) | 15–20% back within a week | `returning_visit` with `days_since_first` ≤ 7 ÷ new visitors that week (`app_opened` with `first_open`); Umami's Retention report as a cross-check |
| **Calm, long sessions** | 5+ minutes is good; very short is a warning | Umami: average visit duration and bounce rate; `drawing_finished.seconds_drawing` |
| **Sharing on its own** | Any, unasked | `scrawlface_shared` / `scrawlface_downloaded` per visitor (tagging on social media isn't visible to us) |
| **Unprompted feedback**, especially "will I lose my drawings?" | Requests for accounts / sync = demand for a backend | Outside the app (email, social); no in-app feedback for now |

## Signals to keep it as a toy, or drop it
| Signal | How to read it |
|---|---|
| Lots of generating, few finished drawings (a novelty randomiser, not a practice) | `scribble_generated` ÷ `drawing_finished` per visitor climbing; `drawing_started` without `drawing_finished` |
| The gallery stays empty | Few `scrawlface_saved` with `trigger` = `button` |
| Nobody returns after week 1 | `returning_visit` with `days_since_first` > 7 near zero |

## Not measured
- In-app feedback (no feedback button for now) and tagging on social media.
- In Umami, everything outside the funnel (tools, onboarding steps, gestures): those events still go to Vercel, and can be added to `umamiEvents` in `scrawl.js` if the free plan has room.
