# Wordmark fonts

The "Scrawlface" wordmark is set in one of these 8 typefaces, picked at random on each page load, after a break and on a tap (`loadWordmarkFont` / `nextWordmark` in `scrawl.js`). They're bundled so the app works offline.

- **Source:** Google Fonts, the same files the app used to download at run time: each `.woff2` is Google's subset containing only the letters of "Scrawlface" (requested with `&text=Scrawlface`), for the weight and style the app uses.
- **Licences:** `licenses/<font>.txt`, one per font. All are under the SIL Open Font License 1.1, except Permanent Marker (Apache License 2.0). The licence texts come from the Fontsource npm packages of the same fonts.
- **Reserved Font Names:** Monoton, Lobster, UnifrakturMaguntia and Press Start 2P declare a Reserved Font Name. Under the OFL a subset counts as a modified version, which strictly shouldn't carry that name. If that matters for distribution (e.g. in the native app), replace those subsets with the full, unmodified font files.

To add a font: download its subset with `&text=Scrawlface`, add the file and its licence here, and an entry to `wordmarkFonts`.
