# CoverVinyl

Make vinyl-flavoured Instagram reels from your own footage. Two editors, switchable from the
top bar:

- **Cover Crate** — your clip plays in the background, a stack of album covers flips forward
  one record at a time, and the credits (song, artist, album, year, producer…) slide in
  underneath.
- **Photo Reel** — your photos and clips cut on the beat, with your own animation (with
  transparency) looping on top, graded with film looks and grain.

Both export a 9:16 or 3:4 video ready for Instagram.

**Live app: https://markdo27.github.io/covervinyl/**

Everything runs in the browser. Files are never uploaded anywhere.

## Cover Crate

| Step | What you do |
| --- | --- |
| **1. Recorded video** | Upload the clip that plays in the background (MP4 / MOV / WebM). Trim the start, zoom, reposition, darken, loop, keep or drop its audio. |
| **2. Album covers** | Upload one or more covers — each becomes a slide. Upcoming covers peek out behind the current one like records in a crate. Reorder, replace or add slides. |
| **3. Text** | Text is a stack of sections you can add, remove, rename and reorder. Each section is either *different on each slide* (e.g. the credits) or *the same on every slide* (e.g. a footer), with its own size, spacing and colour — keep one kind, both, or none for covers only. Pick a default text colour, or colour individual words with the toolbar's colour button. The first per-slide section can have a "morph intro" so its title grows from one text into another (e.g. `jazz**matic**` → `jazz samples: **illmatic**`). |
| **4. Fonts** | Upload your own `.ttf` / `.otf` / `.woff` / `.woff2` files (drop Regular, Bold and Italic together). The family name and weight are read from the font file itself. |
| **5. Look & grain** | Post-process the whole frame: cinematic colour looks (Teal & Orange, Film Print, Bleach Bypass, Faded Matte, Warm 70s, Moonlight, Cross Process, Vivid, Noir) or your own `.cube` LUT, with an intensity slider, plus film grain and a vignette. |
| **6. Duration & export** | Set how long each cover stays on screen (or match the clip length), add an end card with your logo (optionally recoloured to any colour), pick **9:16** (1080×1920) or **3:4** (1080×1440) and export. |

Drag the preview to move the cover + text block. Space bar plays / pauses. "Safe zones"
shows where Instagram's UI covers a Reel.

## Photo Reel

| Step | What you do |
| --- | --- |
| **1. Photos & clips** | Upload many photos and videos at once (they play in file-name order). Each shot gets a length (and a start point for clips); reorder, replace, shuffle, set every shot to one length. Cut, fade or flash between shots, plus an optional slow zoom. |
| **2. Animation on top** | Upload your animation with transparency — **WebM with alpha**, a **PNG sequence** (select all frames; choose the fps), an animated **GIF / APNG / WebP**, or a still PNG. Size, position (drag it in the preview), opacity, speed and blend mode; keep it clean or let the look and grain affect it too. A demo animation shows until you upload yours. |
| **3. Soundtrack & beat** | Optional music (MP3, M4A, WAV…) with start point and volume, and *cut on the beat*: set the BPM and beats per shot to time every cut. Clip sound is muted. |
| **4. Look & grain** | The same colour looks / `.cube` LUTs, film grain and vignette as Cover Crate (defaults to a warm, grainy film look). |
| **5. Export** | 9:16 or 3:4, 1080p or 720p, 24/30/60 fps. |

Animation tips: from After Effects, render *WebM (VP9) with alpha* or a *PNG sequence (RGB +
Alpha)*. ProRes 4444 `.mov` files don't play in browsers; Safari can use HEVC-with-alpha `.mov`.

### Text markup

```
**bold**   *italic*   ~light~   {#e2402f}coloured{/}   # headline line   \* (literal asterisk)
```

Example slide:

```
**"Mind Rain" Joe Chambers**
*Double Exposure* **1978**
-
**"N.Y. State of Mind"**
Produced by {#e2402f}**DJ Premier**{/}
```

## Export

- **Fast (default):** frames are decoded and encoded with WebCodecs (via
  [Mediabunny](https://mediabunny.dev)), faster than real time and frame-accurate — including
  every reel clip, the alpha channel of a WebM overlay, and the soundtrack.
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
npm test           # unit tests (markup, layout, morph, timeline, fonts, sections, LUTs, reel)
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
  renderer.ts      Cover Crate frame at time t: background, cover crate, text, footer, end card
  reel.ts          Photo Reel model, defaults and timing (cuts, fades, beat lengths)
  reelRenderer.ts  Photo Reel frame: shots, slow zoom, flash, overlay, demo animation
  overlay.ts       overlay uploads: alpha video, PNG sequence, GIF/APNG/WebP, still
  reelMedia.ts     keeps reel clips / overlay / soundtrack elements in sync with the playhead
  textLayout.ts    rich-text layout + word wrap on canvas
  markup.ts        **bold** / *italic* / ~light~ / # headline parser
  morph.ts         character morph between two titles (LCS matching)
  timeline.ts      slide timing and clip time mapping (trim / loop)
  fonts.ts         built-in fonts, uploaded fonts (FontFace), TTF/OTF name parsing
  sections.ts      text sections (per-slide / shared) and how they stack
  luts.ts          built-in looks baked to 3D LUTs, .cube parser
  post.ts          WebGL2 post pass: LUT, vignette, film grain
  compositor.ts    layered frame + post pass, shared by previews and exporters
src/export/      encoder.ts (shared WebCodecs plumbing), webcodecs.ts + recorder.ts (Cover
                 Crate, fast + real-time), reel.ts (Photo Reel, fast + real-time)
src/components/  React UI: Player (shared preview shell), steps for each mode, export dialog
src/CoverApp.tsx, src/ReelApp.tsx   the two editors; App.tsx switches between them
```

The preview and the exporters share the same compositor, so what you see is exactly what you get.
