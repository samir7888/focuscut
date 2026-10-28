# OpenCode Build Prompt: "Focuscut" (working name)

A free, browser-only screen recorder and editor for builders. It records a web page, auto-zooms into inputs and buttons with smooth camera motion, adds page-info overlays (text, cards, callouts), and exports a polished marketing video. No backend database. Recordings are stored locally. Deploys for $0.

> Rename the product anywhere you see "Focuscut". Keep the name in a single constant (`src/config/brand.ts`).

---

## 0. How you (the agent) must work

1. **Read this whole file before writing code.** It is the source of truth. If something is ambiguous, pick the simplest option that satisfies the acceptance criteria and note the decision in `docs/DECISIONS.md`.
2. **Build in the phases in section 17.** Finish and verify one phase before starting the next. After each phase, run the checks listed for that phase and fix failures.
3. **Do not invent features outside this spec.** Anything under "Later" (section 19) stays out of the build.
4. **Never add a database, auth, or paid service.** Everything runs in the browser, plus one optional stateless serverless function.
5. **Keep the camera engine pure and testable** (section 7). It must have unit tests.
6. **Use real content, not lorem ipsum**, in the UI and landing page. Follow the copy rules in section 15.
7. **Verify in a real browser** (Chromium). Where your environment supports it, take screenshots of the editor and landing page, critique them against section 14, and fix issues.
8. **Commit in small steps** with clear messages, one commit per meaningful unit of work.
9. Before using any library API you are unsure about (WebCodecs muxers, Cloudflare Pages Functions, Tailwind v4 setup), check its current documentation instead of guessing. Package APIs change.

---

## 1. Product summary

**Who it is for:** indie builders, founders, and developers who need a product demo video of their own web page for launches, landing pages, and social posts.

**Core promise:** record once, get a video that looks designed. No video editor needed.

**The three stages:**

1. **Analyze:** read the page being demoed (title, headline, features, buttons, forms, brand colors) and turn it into overlay content.
2. **Record:** capture the screen or tab video plus a separate event log (cursor, clicks, focus, typing, element rectangles).
3. **Edit and export:** auto-generated zoom segments, cursor effects, backgrounds, overlays, trim and speed, then export MP4, WebM or GIF.

**Key design decision:** record **raw video + JSON event log separately**. All zoom, cursor, background, and overlay effects are applied at **edit and export time**, never baked into the recording. This makes editing non-destructive and lets users tweak zoom without re-recording.

---

## 2. Hard constraints

- **Cost: $0.** Static frontend on Cloudflare Pages. At most one stateless serverless function (Cloudflare Pages Function) for URL analysis. No database, no KV for now.
- **No accounts, no login.** The app is fully free for now.
- **Local storage only.** Recordings and projects live in the user's browser (IndexedDB) and can be saved to disk. Nothing is uploaded.
- **Target browsers:** latest Chrome and Edge first. Detect unsupported browsers (Safari/Firefox) and show a clear message listing what will not work. Do not silently fail.
- **HTTPS or localhost only** (required by `getDisplayMedia`).
- **Privacy:** no analytics that send recording data anywhere. If you add analytics, it must be cookieless, optional, and never touch recordings.
- **Payments later:** keep a single `src/config/features.ts` flags file and a `src/lib/entitlements.ts` that currently returns "everything unlocked". When Dodo Payments is added later, only that file changes. Do not build any payment UI now.

---

## 3. Tech stack (all free)

| Concern | Choice |
|---|---|
| Framework | Vite + React 18 + TypeScript (strict) |
| Styling | Tailwind CSS (current major) + CSS variables for design tokens |
| UI primitives | Radix UI (via shadcn/ui components copied in, restyled to our tokens) |
| State | Zustand (single `projectStore`, plus `uiStore`) with Immer for updates |
| Rendering | Canvas 2D first. Isolate rendering behind a `Renderer` interface so a WebGL renderer can replace it later |
| Animation | Own critically-damped spring (section 7). Framer Motion only for UI chrome, never for the video camera |
| Recording | `getDisplayMedia`, `MediaRecorder` (WebM/VP9 or VP8 fallback), optional mic via `getUserMedia` |
| Export | WebCodecs (`VideoEncoder`) + an MP4 muxer library (check current maintained option, e.g. Mediabunny or mp4-muxer). Fallback: `ffmpeg.wasm` lazy-loaded for GIF and edge cases |
| Local storage | IndexedDB via `idb`; File System Access API to save to disk where available, with download-link fallback |
| Page analysis | Cloudflare Pages Function (`/functions/api/analyze.ts`) + client-side DOM reading when the agent is present |
| Optional AI text | Gemini free tier or Cloudflare Workers AI, behind a flag. Must work without it (rule-based fallback) |
| Testing | Vitest (unit), Playwright (smoke e2e with fake media stream flags) |
| Lint/format | ESLint + Prettier, `tsc --noEmit` in CI |
| Hosting | Cloudflare Pages |

Package manager: pnpm. Node: current LTS.

---

## 4. Capture reality check (read carefully)

A pure web app **cannot see the cursor or DOM of other windows or tabs**. `getDisplayMedia` gives only pixels. So accurate auto-zoom needs a source of events. Support these modes, in this priority:

### Mode A: Agent snippet (primary, ships first)
The user adds one script tag to **their own page**, or pastes it in the console:

```html
<script src="https://YOUR-APP/agent.js" data-studio="https://YOUR-APP"></script>
```

- The studio opens the target page with `window.open(url)` (a separate tab or popup) so the agent can talk back through `window.opener.postMessage`. Always validate `event.origin` on both sides.
- The agent reports pointer, click, focus, key activity, scroll, and element rectangles (section 6).
- The user then shares **that tab** through `getDisplayMedia` (prefer `preferCurrentTab: false`, and use `displaySurface: "browser"` as a hint).
- The agent also reads the page DOM for the analyzer (section 9), so URL-only analysis via the Function is not required in this mode.

### Mode B: Manual zoom (always available)
For any screen or window with no agent: record video only. The editor lets the user add zoom segments by hand on the timeline and pick a target by dragging a rectangle on the preview. Cursor effects are unavailable because there is no cursor data. Say so clearly in the UI.

### Mode C: Browser extension (Later, section 19)
Extension gives DOM and cursor data on any site. Not in this build. Design the event log so the extension can feed the same format later.

**UI requirement:** the Record screen must show which mode is active and what the user gets from it, in plain words, before they hit Record.

---

## 5. Project data model

Define these in `src/types/project.ts` and validate persisted data with Zod.

```ts
export type Ms = number; // milliseconds on the VIDEO timeline (t=0 is first video frame)

export interface Project {
  id: string;
  version: 1;
  name: string;
  createdAt: number;
  updatedAt: number;
  media: {
    videoBlobId: string;       // key in IndexedDB blob store
    audioBlobId?: string;
    width: number;             // video pixel width
    height: number;
    durationMs: Ms;
    devicePixelRatio: number;  // dpr of the captured surface at record time
  };
  events: RecordedEvent[];     // raw log, immutable after recording
  analysis?: PageAnalysis;
  edit: EditState;             // everything the user can change
}

export type RecordedEvent =
  | { t: Ms; type: "pointer"; x: number; y: number }               // viewport CSS px
  | { t: Ms; type: "click"; x: number; y: number; button: number; target?: ElementRef }
  | { t: Ms; type: "focus"; target: ElementRef }
  | { t: Ms; type: "blur"; target: ElementRef }
  | { t: Ms; type: "input"; target: ElementRef }                    // typing, no key content stored
  | { t: Ms; type: "key"; combo: string }                           // only shortcut combos, never plain typing
  | { t: Ms; type: "scroll"; x: number; y: number }
  | { t: Ms; type: "viewport"; w: number; h: number; dpr: number }; // resize / dpr change

export interface ElementRef {
  selector: string;                                                 // best-effort CSS path
  tag: string;
  role?: string;
  label?: string;                                                   // aria-label / text, truncated to 60 chars
  rect: { x: number; y: number; w: number; h: number };            // viewport CSS px at event time
}

export interface EditState {
  trim: { startMs: Ms; endMs: Ms };
  zooms: ZoomSegment[];
  speeds: SpeedSegment[];
  overlays: Overlay[];
  cursor: CursorStyle;
  frame: FrameStyle;           // background, padding, radius, shadow, browser mockup
  output: OutputSettings;      // aspect ratio, resolution, fps
  zoomPreset: "subtle" | "balanced" | "intense";
}

export interface ZoomSegment {
  id: string;
  startMs: Ms;
  endMs: Ms;
  scale: number;                              // 1.0 to 3.5
  target:
    | { kind: "rect"; x: number; y: number; w: number; h: number }  // in VIDEO pixels
    | { kind: "follow-cursor" };
  source: "auto" | "manual";
  reason?: "click" | "focus" | "typing" | "hover";
  locked?: boolean;                           // user edited it; auto-regeneration must not overwrite
}
```

Notes:
- Never store typed text. Store only that typing happened (`input` events), to protect passwords and private data.
- Project JSON can be exported and imported (`.focuscut.json` + video file bundle, or a zip).

---

## 6. Event capture and time sync

### 6.1 The agent (`public/agent.js`, plain TypeScript compiled to one tiny file, no dependencies)

Capture with passive listeners, throttled:

- `pointermove`: throttle to about 60 Hz, send `x,y` in viewport CSS pixels.
- `pointerdown`/`click`: send position plus `ElementRef` of the closest meaningful ancestor (button, a, input, textarea, select, `[role=button]`, label).
- `focusin`/`focusout`: send `ElementRef`.
- `input`: send `ElementRef` only (no value).
- `keydown`: only when a modifier is held (Ctrl/Cmd/Alt) or key is Escape/Enter/Tab; send combo string like `Ctrl+K`. Never log plain characters.
- `scroll`: throttle to ~30 Hz.
- `resize` and dpr changes: send `viewport` event.
- On `ElementRef.rect`, always use `getBoundingClientRect()` at event time. Re-measure the focused element on scroll/resize while it has focus (throttled), since layout shifts.
- Ignore elements inside `[data-focuscut-ignore]`.
- Show nothing visible on the page. Expose a tiny `window.__focuscut` object only for the handshake.

### 6.2 Handshake and clock sync

1. Studio opens the target and sends `{type:"hello", studioTime: performance.now(), wall: Date.now()}`.
2. Agent replies with its own `performance.now()` and `Date.now()`. Run 5 round trips, take the median offset with the lowest round-trip time.
3. When recording starts, the studio stores `recordStartWall = Date.now()` at the exact `MediaRecorder` `start` event.
4. Agent events are stamped with agent-local `performance.now()`. Convert to video time: `t = agentNow - agentOffset - (recordStartWall - studioWallAtHandshake...)`. Implement this in one function `toVideoTime()` with unit tests using synthetic offsets.
5. Provide an **"Adjust sync" nudge** in the editor (+/- 500 ms in 10 ms steps) applied to all events, since audio/video start latency varies.
6. Drop events with `t < 0`.

### 6.3 Coordinate mapping (most common source of bugs)

Write `src/engine/coords.ts`:

- Inputs: event rect in viewport CSS px, video size in px, recorded `devicePixelRatio`, and whether the captured surface is tab content only or a window with browser chrome.
- For **tab capture**, video pixels = CSS px * dpr, origin at viewport top-left. Check this empirically: compute `video.videoWidth / viewport.w` and compare against dpr. If they disagree, trust the measured ratio and log a warning.
- For **window/screen capture**, the browser UI offsets the page. Detect the offset by letting the user calibrate once: show a one-time "click the top-left corner of your page" step, or fall back to Mode B. Do not guess.
- Provide `cssRectToVideoRect()` and `videoRectToCssRect()` with property-based tests (round trip is stable).
- Add a **debug overlay** (toggle in editor) that draws every event rect and cursor point on top of the video so misalignment is visible instantly.

---

## 7. Zoom and camera engine (the core)

Implement as a **pure, deterministic module** in `src/engine/camera/` with zero DOM access. It must be usable in the preview, in export, and in tests.

### 7.1 Step 1: events to intents

Convert raw events to `Intent[]`:

| Source event | Intent | Weight |
|---|---|---|
| `focus` on input/textarea/select | `focus` | high |
| `input` bursts | `typing` (extends the active intent) | high |
| `click` on button/link/`[role=button]` | `click` | high |
| `click` elsewhere | `click-point` (small box around cursor) | medium |
| Cursor dwell: pointer within 24px for >= 600 ms over an interactive element | `hover` | low |

Each intent carries a target rect (video pixels), a time, and a reason.

### 7.2 Step 2: debounce (400 ms)

- Cluster intents: any intent within **400 ms** of the previous one in the same cluster joins that cluster.
- A cluster produces **one** zoom target. If targets in a cluster are close (union bbox smaller than 45% of the frame), zoom to the union. Otherwise use the **last** intent's target.
- Because editing is offline and the future is known, start each zoom segment **150 ms before** the cluster's first intent (anticipation), so the camera arrives as the action happens. For the live-preview during recording (if built), use a true trailing 400 ms debounce instead.
- Make `DEBOUNCE_MS = 400` a constant in `src/engine/camera/constants.ts`, overridable by preset.

### 7.3 Step 3: segments

For each cluster build a `ZoomSegment`:

- `scale = clamp(fitScale(targetRect), preset.minScale, preset.maxScale)` where `fitScale` makes the target occupy about `preset.targetFill` of frame width (default 0.35), capped by the preset.
- `endMs = lastIntentTime + holdMs`, with `holdMs` at least **800 ms**. Typing extends the segment while `input` events keep arriving (gap < 1200 ms).
- **Hysteresis:** if the next segment starts within **1500 ms** of this one ending, do not zoom out to 1.0. Pan directly to the next target at the same or new scale. This avoids in-out-in jitter.
- Enforce a minimum segment duration of 900 ms and a maximum scale of 3.5.
- Presets:

| Preset | min / max scale | targetFill | hold | notes |
|---|---|---|---|---|
| subtle | 1.2 / 1.6 | 0.55 | 800 ms | few zooms, clicks and inputs only |
| balanced (default) | 1.4 / 2.2 | 0.40 | 1000 ms | clicks, inputs, buttons |
| intense | 1.6 / 3.0 | 0.30 | 1200 ms | includes hover intents |

- Segments the user edited get `locked: true`. "Regenerate zooms" keeps locked ones and replaces the rest.

### 7.4 Step 4: camera simulation

State: `{ cx, cy, scale }` where `cx,cy` is the camera center in video pixels.

- Goal at time `t`: the target of the active segment, otherwise `{ videoW/2, videoH/2, 1 }`.
- Use a **critically damped spring** per channel, integrated with a **fixed timestep** (1/240 s) so results do not depend on frame rate:
  - `omega = 2π / settleTime` (settleTime about 0.55 s for zoom-in, 0.7 s for zoom-out; asymmetry feels better)
  - `accel = omega² * (goal - x) - 2 * omega * v`, semi-implicit Euler or an exact analytic step.
- Interpolate `scale` in **log space** so zooming feels perceptually even.
- **Clamp** the visible rect so it never leaves the video: `halfW = videoW / (2*scale)`, clamp `cx` into `[halfW, videoW-halfW]`, same for `cy`.
- **Pre-bake** the camera path: simulate the whole timeline once at 240 Hz into a typed array, then sample with linear interpolation at any `t`. This makes seeking and scrubbing instant and exports deterministic. Re-bake whenever zoom segments, trim, or speed change (debounce the re-bake by 100 ms in the UI).
- Add a gentle **look-ahead pan** for `follow-cursor` segments: low-pass the cursor position (spring with settleTime about 0.35 s) and keep the cursor within the central 60% of the visible area.
- Optional **motion blur** (Later): blend 2 to 3 sub-frames when camera speed exceeds a threshold. Off by default.

### 7.5 Tests (required)

- Debounce: events at 0, 200, 399, 800 ms produce clusters `[0,200,399]` and `[800]`.
- Hysteresis: two segments 1200 ms apart pan without returning to scale 1.
- Clamping: camera never exposes pixels outside the video for any target at the edges.
- Determinism: baking twice gives identical arrays; sampling at 30 and 60 fps gives consistent positions.
- Overshoot: critically damped spring never overshoots the goal by more than 0.5%.

---

## 8. Cursor and effects

Because the cursor position comes from the event log, **draw our own cursor** and hide the real one (the captured cursor is hard to control).

- **Smoothing:** low-pass or spring-smooth the pointer path, then apply optional curve fitting (Catmull-Rom through pointer samples at 30 Hz) so jitter becomes a smooth arc. Keep the path faithful at clicks (no smoothing lag at click time: snap the smoothed cursor to within 1 px at each click).
- **Styles:** a clean arrow, a pointer hand over links and buttons, and an I-beam over inputs (decide by `ElementRef.tag`/role). Size slider 0.8x to 2.5x.
- **Click effect:** a ring that expands and fades over ~450 ms, plus a 0.92 scale squish on the cursor. Color uses the accent token.
- **Idle hide:** fade the cursor after 2.5 s of no movement (toggle).
- **Spotlight:** optional soft dim of everything outside a circle or the active zoom target.
- **Keystroke badges:** show shortcut combos from `key` events as pill badges that fade after 1.2 s.
- **Cursor is rendered in video space**, so zoom scales it naturally. Keep the cursor visually constant in size when zoomed if the "constant size" toggle is on.

---

## 9. Page analyzer and info overlays

### 9.1 Getting the info

Two sources, same output type:

1. **Agent source (in Mode A):** the agent runs `analyzeDocument(document)` locally and sends the result. Most accurate, no network.
2. **URL source:** the user pastes a URL. Call `/api/analyze?url=...` (Cloudflare Pages Function). The Function fetches the HTML, parses it with a lightweight parser (e.g. `linkedom` or `node-html-parser`, or Cloudflare's `HTMLRewriter`), and returns JSON.

**Function security (required):**
- Allow only `http:` and `https:`. Resolve the host and **block private, loopback, link-local, and metadata IP ranges** (SSRF protection). Do not follow redirects blindly: re-check each hop, max 3.
- Timeout 8 s, response size cap 2 MB, content-type must be HTML.
- Rate limit with a simple per-IP in-memory counter plus Cloudflare's built-in protections. No storage.
- CORS: allow only the app's own origin.
- Never execute scripts from the fetched page. Static HTML only; tell the user JS-rendered pages work best through the agent.

### 9.2 `PageAnalysis` type

```ts
export interface PageAnalysis {
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  logo?: string;                       // data URL, fetched and inlined (max 200 KB)
  brand: { colors: string[]; fonts: string[] };   // dominant colors from computed CSS / theme-color / OG image
  headings: { level: 1 | 2 | 3; text: string }[];
  features: { title: string; text?: string }[];   // from lists, cards, repeated sections
  ctas: { text: string; selector?: string; rect?: Rect }[];
  forms: { label?: string; fields: { label?: string; type: string; selector?: string }[] }[];
  stats: { value: string; label: string }[];      // detected numbers like "10k users"
  pricing?: { plan: string; price: string }[];
  testimonials?: { quote: string; author?: string }[];
  summary?: { tagline: string; bullets: string[]; script: string[] }; // AI or rule-based
}
```

### 9.3 Turning analysis into content

- **Rule-based fallback (must work offline):** tagline = H1 or title; bullets = first 3 to 5 features; script = one sentence per feature.
- **Optional AI (behind flag):** one call that returns JSON `{tagline, bullets[], script[]}`; validate with Zod; on any failure silently use the fallback and show a small, non-blocking notice. Never block the editor on AI.
- Quote limits: truncate scraped text and never include it in the UI as if the app wrote it. Show the source ("from your page").

### 9.4 Overlay types (render on the canvas, part of export)

| Overlay | Description |
|---|---|
| `titleCard` | Logo, product name, tagline over the styled background. Used as intro |
| `lowerThird` | Name plus one-line description, bottom-left, slides in |
| `featureCard` | Icon, title, 1-line text; appears pinned to a side of the frame, timed to a segment |
| `callout` | Bubble with arrow pointing at an element rect (uses `ElementRef.rect` mapped through the camera so it stays attached while zoomed) |
| `stat` | Number counter animating to its value, with label |
| `stepBadge` | "Step 2: Add your data" pill, only for real sequences |
| `ctaCard` | End card with URL and primary action text |
| `text` | Free text box |
| `blur` | Rectangular blur/mask region for sensitive info (tracks the camera) |

Each overlay: `{ id, type, startMs, endMs, anchor: "screen" | {kind:"element", rect}, style, content }`. Entrance and exit animations are 250 to 350 ms. Provide a **"Suggest overlays"** button that places overlays from the analysis at sensible times (title at 0, feature cards when the matching element is zoomed, CTA at the end). Users can then drag, edit text, retime, or delete each overlay.

---

## 10. Editor UI

Layout (desktop, 1280 px+). Below 1024 px show a read-only message: "Editing works best on a larger screen. Your recordings are saved." Landing and library pages remain responsive.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Project name            [Undo][Redo]      [Preview in 1080p ▾] [Export] │
├────────┬──────────────────────────────────────────────┬─────────────────┤
│ Tools  │                                              │  Inspector      │
│  Zoom  │               Canvas preview                 │  (context for   │
│  Cursor│          (aspect-ratio aware, 60fps)         │  the selected   │
│  Frame │                                              │  clip/overlay   │
│  Text  │                                              │  or the tab)    │
│  Page  │                                              │                 │
├────────┴──────────────────────────────────────────────┴─────────────────┤
│ ▶  00:12.480 / 00:45.000        Timeline                                │
│ Zoom   ▭▭▭   ▭▭▭▭▭    ▭▭                                                │
│ Speed       ▭▭▭                                                         │
│ Overlay ▭▭   ▭▭▭         ▭▭▭                                            │
│ Video  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Screens**

1. **Home / Library:** large "New recording" action, then the local project grid (thumbnail, name, duration, date, size on disk). Empty state explains what to do in one sentence and has a single button. Show total local storage used and a "free up space" action.
2. **Setup (before recording):** choose mode (agent / manual), URL field with **Analyze** (shows analysis result as cards live), audio options, aspect ratio, countdown. Show the agent snippet with a copy button and a connection status indicator ("Page connected" / "Waiting for page").
3. **Recording HUD:** a small floating control (Document Picture-in-Picture if available, otherwise a compact control in the studio tab): timer, pause/resume, stop, mic meter. Global shortcut hints. Never record the HUD itself where avoidable.
4. **Editor:** as above.
5. **Export dialog:** format, resolution, fps, aspect, quality, estimated size, progress bar with cancel, and a "Save to folder" action.

**Timeline requirements**

- Zoom, speed, and overlay lanes with drag to move, drag edges to resize, `S` to split, `Delete` to remove, snap to other clip edges and the playhead (hold Alt to disable snap).
- Click a zoom clip to open the inspector: scale slider (1.0 to 3.5), start/end fields, target mode (rect or follow cursor), "pick target on preview" (drag a rectangle), easing speed (fast, normal, slow), "lock" state.
- Zoom clips render as a small curve showing scale over time, so users see the shape.
- Waveform for audio if present.
- Zoom in/out of the timeline with `Ctrl+scroll`. Playhead scrubbing must update the canvas within one frame.
- Undo/redo for **every** edit (command history, at least 100 steps).
- Autosave to IndexedDB (debounced 1 s) with a subtle "Saved" status.

**Playback**

- Preview renders from the hidden `<video>` element plus the baked camera path. Use `requestVideoFrameCallback` where available for frame-accurate drawing; fall back to `requestAnimationFrame`.
- Keyboard: `Space` play/pause, `J/K/L` shuttle, `←/→` frame step, `Shift+←/→` 1 s, `Z` add zoom at the playhead, `[`/`]` set trim.

---

## 11. Frame styling (the "designed" look)

- **Background:** solid, linear/mesh gradients, image presets (ship 8 to 12 original CSS/SVG-generated presets; do not ship copyrighted wallpapers), custom upload, and a **"from my page"** option that builds a gradient from the analyzed brand colors.
- **Padding** (0 to 25%), **corner radius**, **shadow** (soft, directional), optional **inset border**.
- **Browser mockup:** minimal window chrome with traffic-light dots and a URL pill showing the analyzed URL. Also "none" (crop to content).
- **Aspect ratios:** 16:9, 1:1, 4:5, 9:16. Switching ratio re-computes the camera bounds. Zooms must respect the new frame so targets stay visible.
- Safe-area guides toggle for social platforms.

---

## 12. Export pipeline

- **Render loop (offline, faster than real time):** for each output frame at time `t`, compute the source time from the speed segments, sample the camera at `t`, draw video frame + frame styling + cursor + overlays on an `OffscreenCanvas`, then encode.
- Decode source frames with a `<video>` element seeked per frame **or** WebCodecs `VideoDecoder` if demuxing is available. Start with the seeked-video approach (simpler), measure, and note performance in `docs/DECISIONS.md`.
- Encode with `VideoEncoder` (H.264 `avc1` when available, VP9 otherwise) and mux to MP4 (or WebM). Stream chunks to avoid holding the whole file in memory.
- **Audio:** pass through or re-encode with `AudioEncoder` (AAC/Opus) and align with speed changes (pitch-corrected if feasible, otherwise mute sped-up regions and warn).
- **GIF:** palette-based via `ffmpeg.wasm` (lazy loaded), capped at 15 fps and 720 px wide by default.
- Run export in a **Web Worker** so the UI stays responsive. Report progress, support cancel, and show estimated time remaining.
- **Presets:** "Web (1080p, 30 fps)", "Social vertical (1080x1920)", "Crisp (4K, 30 fps)", "GIF". Default bitrate by resolution; expose a quality slider.
- Verify exported files play in VLC and Chrome and upload to X and LinkedIn conditions (H.264 + AAC, yuv420p, even dimensions).

---

## 13. Local storage and persistence

- IndexedDB stores: `projects` (JSON), `blobs` (video/audio, chunked), `thumbs`. Use `navigator.storage.persist()` and show an honest notice that browsers can clear data under storage pressure.
- While recording, **append chunks to IndexedDB every 2 s** so a crash or accidental tab close loses at most a couple of seconds. On next load, offer to recover an unfinished recording.
- **Save to disk:** `showDirectoryPicker` / `showSaveFilePicker` when available (remember the chosen folder handle), otherwise download via `<a download>`.
- **Export/import project bundle** so users can back up and move projects.
- Show storage usage and per-project size. Provide delete with confirmation, and a "Clear everything" in settings.
- Add a `Storage` interface so a cloud backend could be added later without touching UI code.

---

## 14. Design system and frontend design direction

This section is the design brief. Follow it exactly. Where it says something specific, do not replace it with the generic default you would use for any SaaS page.

### 14.1 Subject, audience, job

- **Subject:** a precision video tool whose entire idea is *focus*: a camera that finds the right place to look.
- **Audience:** builders who care about craft and speed, often working late, comfortable with keyboard shortcuts.
- **Primary job of the product UI:** let someone make a good-looking video in minutes without feeling lost in a video editor.
- **Primary job of the landing page:** get a builder to record their first demo, by showing the zoom working.

### 14.2 Visual identity: "viewfinder"

The visual language comes from camera viewfinders and lens focus: corner brackets, focus rings, tally lights, a steady dark working surface where your footage is the brightest thing on screen.

**Color tokens (define as CSS variables in `src/styles/tokens.css`, exposed to Tailwind):**

| Token | Hex | Use |
|---|---|---|
| `--surface-0` (stage) | `#121418` | App background, behind the canvas |
| `--surface-1` (panel) | `#1A1D23` | Panels, sidebars |
| `--surface-2` (raised) | `#232730` | Inputs, menus, hovered rows |
| `--line` | `#2E333D` | Dividers and control borders |
| `--text` | `#E9ECF1` | Primary text |
| `--text-muted` | `#9AA1AE` | Secondary text (meets 4.5:1 on panels; verify) |
| `--focus` (accent) | `#F5C242` | Focus brackets, zoom clips, selection, primary actions |
| `--focus-ink` | `#241B00` | Text on the accent color |
| `--rec` | `#FF5A4F` | Recording state only, never decoration |
| `--ok` | `#4CC38A` | Success and saved states |

Rules:
- The **accent is spent in one idea: focus.** It marks the zoom clips, the selection, the focus brackets, and the primary button. Do not use it for general decoration, gradients, or glows.
- `--rec` appears only when recording is live or armed.
- Provide a **light theme** with the same semantic tokens (warm-neutral light surfaces, the accent darkened to pass contrast on white). Respect `prefers-color-scheme` and add a manual toggle. The editor defaults to dark.
- Avoid the common generated-design looks: cream background with terracotta accent, near-black with acid green, newspaper columns with hairlines, and identical rounded cards with the same soft shadow everywhere.

**Typography (self-host via fontsource; do not hotlink):**

- UI and body: **Geist Sans** (or the closest available alternative if unavailable).
- Marketing headlines and the logo wordmark: **Bricolage Grotesque** at tight tracking and large optical sizes. It should look deliberate, not like a default sans.
- Timecodes and numeric readouts only: **Geist Mono** with `font-variant-numeric: tabular-nums`. Do not use monospace for ordinary labels.
- Type scale (rem): 0.75, 0.8125, 0.9375, 1.125, 1.5, 2.25, 3.5, 5. Body 15 px in the editor, 17 px on the landing page. Line length under 75 characters. Line-height 1.45 for body, 1.05 to 1.15 for display.
- Do **not**: accent a single word in a headline with color or italics; use tracked ALL-CAPS eyebrow labels above headings; add decorative labels that carry no information.

**Shape and depth:**

- Radius by hierarchy, not one value everywhere: 4 px on small controls, 8 px on panels and inputs, 14 px on the video frame preview, 20 px on dialogs. The exported video's frame radius is user-controlled.
- Depth comes from surface color steps (`surface-0/1/2`) and 1 px `--line` borders. Use shadows only for floating things (menus, dialogs, the HUD) and for the video frame itself.
- **Signature element:** corner **focus brackets** (four L-shaped marks) drawn around the active zoom target in the preview, around the selected zoom clip in the timeline's mini-preview, and as the recording-ready indicator. They animate to the new target in sync with the camera spring. This is the one memorable detail. Keep everything else quiet.

### 14.3 Layout principles

- The **canvas preview is the hero** of the editor. It gets the largest area and the darkest, calmest surround. Panels never compete with it.
- Left-align all text. No centered paragraphs except in the empty state and the export-complete dialog.
- Inspector shows only what applies to the current selection. No "everything at once" settings wall. Use progressive disclosure ("Advanced") sparingly.
- Structural devices encode information: numbered markers only for real sequences (setup steps, onboarding). No decorative numbering, no pill labels for the sake of it.
- Density: compact but not cramped. 8 px spacing grid, 32 px control height, 40 px for primary actions.

### 14.4 Landing page (`/`)

**Hero:** do not use a big number with a gradient. The hero is a **live, looping demo of the zoom engine**: a mock signup form in a styled frame, a drawn cursor moving to the email field, the camera easing in with focus brackets locking on, the user "typing," the camera easing to the submit button, a click ring, then easing out. It runs on the real camera module (same code as the editor) in a canvas. Provide a pause button, honor `prefers-reduced-motion` (show a static frame with brackets and a "Play demo" button).

Content order:
1. Hero: headline, one sentence, **Start recording** (primary) and **See an example export** (secondary), with the live demo beside or below.
2. "How it works": three real steps (Analyze, Record, Edit and export) as a true sequence, so numbering is justified.
3. One feature section showing the page-analysis overlays being generated from a real example page, side by side with the resulting frame.
4. Feature grid, with **varied** card sizes and layouts tied to content (not identical cards).
5. Privacy statement: recordings never leave your device, in plain words.
6. FAQ (browser support, where files are saved, limits).
7. Footer with minimal links.

Motion: one orchestrated moment on load (the hero demo starting). No fade-and-slide-up on every section; no hover transitions on every card. Interaction feedback (button press, toggle, panel open) is welcome.

### 14.5 Component rules

- Buttons: one primary per view (accent fill, `--focus-ink` text). Secondary = outlined with `--line`. Destructive = text style with `--rec`, requires confirmation.
- Inputs: `surface-2` background, 1 px `--line`, accent focus ring (2 px, 2 px offset). Visible keyboard focus everywhere.
- Sliders show value in Geist Mono beside the control and support arrow-key stepping.
- Tooltips on all icon-only buttons, including the shortcut. Icons: Lucide, 1.5 px stroke, 16/20 px.
- Toasts for outcomes ("Saved to Documents/Focuscut"), never for status that the UI already shows.
- Skeletons for loading lists; a progress bar (not a spinner) for export and analysis.

### 14.6 Accessibility and quality floor (non-negotiable)

- WCAG AA contrast for text and controls in both themes.
- Full keyboard operation of the editor (timeline included). Focus order matches visual order. ARIA roles for the timeline (`role="slider"`/`listbox` as appropriate) with labels.
- `prefers-reduced-motion`: disable the hero loop, brackets animate with instant steps, and exported effects are unaffected (export settings are explicit).
- Responsive landing and library down to 360 px; editor shows the "use a larger screen" notice below 1024 px.
- No layout shift on font load (use `font-display: swap` with metric-matched fallbacks).
- Lighthouse on landing: Performance >= 90, Accessibility >= 95 (mobile profile).
- Take screenshots of: landing (desktop and 390 px), library (empty and populated), setup, editor, export dialog. Critique against this section, remove one decorative element per screen, and fix.

---

## 15. Copy rules

- Plain verbs, sentence case, active voice. Name things by what the user sees, not how it is built: "Zoom," not "camera spring"; "Page info," not "DOM analysis."
- Buttons say what happens: "Start recording," "Export video," "Save to folder." The same action keeps the same name everywhere (the button says "Export," the toast says "Exported").
- Errors say what happened and how to fix it, without apologizing. Example: "The page didn't connect. Check that the snippet is on the page and that the tab is still open."
- Empty states invite an action: "No recordings yet. Record a page to get your first demo."
- Never say "magic," "seamless," "supercharge," or "AI-powered" as filler. If AI generated something, label it "Suggested from your page."
- No lorem ipsum anywhere. Landing copy must be specific to this product.

---

## 16. Repository layout

```
focuscut/
├─ public/
│  └─ agent.js                  # built from src/agent
├─ functions/
│  └─ api/analyze.ts            # Cloudflare Pages Function
├─ src/
│  ├─ app/                      # routes: home, setup, record, editor
│  ├─ components/               # ui/ (shadcn-based), editor/, landing/
│  ├─ engine/
│  │  ├─ camera/                # intents, cluster, segments, spring, bake (PURE)
│  │  ├─ render/                # Renderer interface, canvas2d renderer, cursor, overlays, frame
│  │  ├─ coords.ts
│  │  ├─ sync.ts
│  │  └─ export/                # worker, encode, mux, gif
│  ├─ agent/                    # agent source (separate Vite entry)
│  ├─ analysis/                 # DOM analyzer shared by agent and Function
│  ├─ storage/                  # idb wrappers, bundle import/export
│  ├─ stores/
│  ├─ types/
│  ├─ config/                   # brand.ts, features.ts
│  └─ styles/                   # tokens.css, base.css
├─ docs/DECISIONS.md
├─ tests/                       # vitest + playwright
├─ wrangler.toml
└─ README.md
```

---

## 17. Build phases and acceptance criteria

### Phase 1: Foundations
- Vite + React + TS strict, Tailwind with tokens, fonts, light/dark themes, routing, base layout shell.
- Browser support check and message.
- **Done when:** app runs, theme toggle works, lint/typecheck/tests pass, tokens match section 14.

### Phase 2: Recording + event capture
- `getDisplayMedia` + MediaRecorder with chunked IndexedDB writes, pause/resume, countdown, optional mic.
- Agent script, handshake, clock sync, event log.
- Setup screen with connection status.
- **Done when:** a 60 s recording of a test page produces a playable video and a log; `toVideoTime()` tests pass; crash recovery restores a partial recording.

### Phase 3: Camera engine + preview
- Intents, 400 ms clustering, segments, hysteresis, spring simulation, bake, clamping, with all tests from 7.5.
- Canvas preview with debug overlay for rects/cursor.
- **Done when:** on the test page, zooms land inside the target rect (verified by test: target rect fully inside the visible rect at segment mid-point), movement is visibly smooth at 60 fps, no frame shows area outside the video.

### Phase 4: Cursor, frame, effects
- Custom cursor and smoothing, click rings, idle hide, keystroke badges, backgrounds, padding, radius, shadow, browser mockup, aspect ratios.
- **Done when:** exported stills match the preview, and the 4 aspect ratios keep targets visible.

### Phase 5: Editor + timeline
- Lanes, drag/resize/split/delete/snap, inspector, undo/redo, autosave, keyboard shortcuts, speed segments, trim.
- **Done when:** a user can regenerate zooms, edit one, lock it, regenerate again, and the locked one survives; undo restores exact state.

### Phase 6: Page analysis + overlays
- Agent analyzer and Function analyzer with SSRF protections, rule-based summaries, optional AI, overlay types, "Suggest overlays."
- **Done when:** analyzing 5 varied pages (static marketing page, SPA via agent, pricing page, form page, blog) returns sensible titles/features/CTAs; SSRF tests (localhost, 169.254.169.254, redirect to private IP, huge response) are rejected.

### Phase 7: Export
- Worker-based renderer, MP4 (H.264 + AAC) and WebM, GIF fallback, progress, cancel, save to folder.
- **Done when:** a 60 s 1080p/30 fps export finishes in under 3x real time on a mid-range laptop (record the number in `docs/DECISIONS.md`), plays correctly everywhere, audio stays in sync after speed changes.

### Phase 8: Landing page and polish
- Landing page per 14.4 with the live engine demo, README, empty/error states, storage management, accessibility pass, Lighthouse targets, screenshots review.
- **Done when:** section 14.6 checks pass and the definition of done below is met.

---

## 18. Definition of done

1. A first-time user records their own page and exports a styled MP4 with auto-zoom in under 5 minutes.
2. Zoom targets are accurate: inputs and buttons are fully visible and centered-ish in the zoomed view (tests plus manual verification on 5 pages).
3. The 400 ms debounce, 800 ms minimum hold, and 1.5 s hysteresis behave as specified and are covered by tests.
4. Camera motion is smooth and deterministic; no jitter, overshoot, or edge exposure.
5. Nothing is uploaded; all data is local; the only network call is the optional analyzer.
6. Works on current Chrome and Edge; clear message elsewhere.
7. Deploys to Cloudflare Pages with `pnpm build` and zero paid services.
8. The UI follows section 14 and passes the accessibility floor.

---

## 19. Later (do NOT build now)

- Chrome extension for DOM and cursor events on any site (Mode C)
- Captions via in-browser Whisper
- Webcam bubble
- Motion blur on camera moves
- Templates (launch video, feature tour, tutorial)
- Shareable links (requires a backend)
- Dodo Payments and license checks (only touch `features.ts` and `entitlements.ts`)

---

## 20. Risks to handle explicitly

| Risk | Handling |
|---|---|
| Event/video clock drift | Handshake sync, median offset, manual nudge, debug overlay |
| Wrong coordinates on window capture | Calibration step or fall back to manual mode; never guess silently |
| Large recordings fill memory | Chunk to IndexedDB, stream export, warn above a size threshold |
| `VideoEncoder` codec support varies | Feature-detect with `isConfigSupported`, fall back to VP9/WebM, then ffmpeg.wasm |
| SSRF through the analyzer | Section 9.1 protections, plus tests |
| Sensitive data in recordings | Never log typed text, blur overlay tool, privacy notice before recording |
| JS-rendered pages unreadable by the Function | Recommend the agent path; say so in the UI when the result is thin |

---

*End of prompt. Start with Phase 1 and report back with what you built, what you verified, and any decisions you made, before moving to Phase 2.*
