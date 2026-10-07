# CoverVinyl

Turn your own recorded video into a vinyl "crate digging" reel: your clip plays in the
background, a stack of album covers flips forward one record at a time, and the credits
(song, artist, album, year, producer…) slide in underneath — then export a 9:16 or 3:4 MP4
ready for Instagram.

**Live app: https://markdo27.github.io/covervinyl/**

Everything runs in the browser. Files are never uploaded anywhere.

## How it works

| Step | What you do |
| --- | --- |
| **1. Recorded video** | Upload the clip that plays in the background (MP4 / MOV / WebM). Trim the start, zoom, reposition, darken, loop, keep or drop its audio. |
| **2. Album covers** | Upload one or more covers — each becomes a slide. Upcoming covers peek out behind the current one like records in a crate. Reorder, replace or add slides. |
| **3. Text** | Edit the text under each cover and the footer line shown on every slide. Optionally give a slide a "morph intro" so its title grows from one text into another (e.g. `jazz**matic**` → `jazz samples: **illmatic**`). |
| **4. Fonts** | Upload your own `.ttf` / `.otf` / `.woff` / `.woff2` files (drop Regular, Bold and Italic together). The family name and weight are read from the font file itself. |
| **5. Duration & export** | Set how long each cover stays on screen (or match the clip length), add an end card with your logo, pick **9:16** (1080×1920) or **3:4** (1080×1440) and export. |

Drag the preview to move the cover + text block. Space bar plays / pauses. "Safe zones"
shows where Instagram's UI covers a Reel.

### Text markup

```
**bold**   *italic*   ~light~   # headline line   \* (literal asterisk)
```

Example slide:

```
**"Mind Rain" Joe Chambers**
*Double Exposure* **1978**
-
**"N.Y. State of Mind"**
Produced by **DJ Premier**
```

## Export

- **Fast (default):** frames are decoded and encoded with WebCodecs (via
  [Mediabunny](https://mediabunny.dev)), faster than real time and frame-accurate.
  Produces **H.264 + AAC MP4** in Chrome, Edge and Safari. Browsers without a native AAC
  encoder use a bundled WebAssembly one.
- **Fallback:** if the browser can't decode the clip or encode with WebCodecs, the edit is
  played back and recorded in real time with `MediaRecorder` (keep the tab visible).
- Browsers that can't encode H.264 at all fall back to WebM (VP9 + Opus); the app tells you
  when that happens, since Instagram prefers MP4.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (markup, layout, morph, timeline, fonts)
npm run build      # static site in dist/
```

The build is a static site with relative asset paths, so `dist/` can be hosted anywhere.

### Deployment

`.github/workflows/deploy.yml` runs the tests, builds the app and publishes `dist/` to the
`gh-pages` branch on every push to `main` (it can also be started by hand from the Actions
tab). GitHub Pages serves that branch — if the site isn't live yet, open
*Settings → Pages* and set *Source: Deploy from a branch → `gh-pages` / `(root)`*.

### Code map

```
src/engine/      rendering engine (framework-free)
  renderer.ts      draws one frame at time t: background, cover crate, text, footer, end card
  textLayout.ts    rich-text layout + word wrap on canvas
  markup.ts        **bold** / *italic* / ~light~ / # headline parser
  morph.ts         character morph between two titles (LCS matching)
  timeline.ts      slide timing and clip time mapping (trim / loop)
  fonts.ts         built-in fonts, uploaded fonts (FontFace), TTF/OTF name parsing
src/export/      WebCodecs exporter + MediaRecorder fallback
src/components/  React UI: the five steps, preview player, export dialog
```

The preview and the exporter share `renderFrame`, so what you see is exactly what you get.
