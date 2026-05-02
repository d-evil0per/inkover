# InkOver

InkOver is a lightweight screen-annotation and quick-record utility built with Electron. It provides a draggable toolbar and per-display transparent overlays so you can draw, highlight, blur or record parts of your screen with minimal friction — ideal for demos, reviews and quick markups.

- Fast keyboard-driven workflow
- Vector-based drawing with undo/redo
- Per-display overlay windows (one overlay per monitor)
- Lightweight screen recorder (GIF/MP4 options)
- Small, focused toolset: pen, shapes, text, spotlight, magnifier, blur/mosaic, eraser, recorder

---

## Quick start

Prerequisites
- Node.js 16+ (or the version specified in .nvmrc)
- macOS / Windows / Linux desktop environment
- On macOS you will be prompted for Screen Recording permission the first time you use capture/recorder features.

Install and run:

```bash
npm install
npm run dev         # developer mode (hot-reloads renderer + main)
npm run build && npm start   # production build + run
```

## Why a new tool?

DrawPen is a great starting point but it has rough edges that frustrate daily use:

| Pain in DrawPen | What InkOver does instead |
| --- | --- |
| Toolbar is fixed in the menu bar | Floating, draggable toolbar window placed wherever you want |
| Freehand strokes stay rough | **Smart shape recognition**: rough rectangles, ellipses, and arrows snap to clean primitives — only when confidence is high, so doodles stay doodles |
| Single-monitor only | One transparent overlay window **per display**, kept in sync as monitors come and go |
| No screen recording | Built-in **WebM and GIF** recording with annotations baked in |
| No way to redact sensitive content | **Blur tool** that mosaics any region behind the annotation layer |
| No spotlight or magnifier | Both included, with Shift+scroll to size the spotlight |
| Annotations vanish on quit | Save/load drawings as portable JSON, export PNG with one keystroke |

## Feature tour

- **Drawing tools**: pen (with adaptive smoothing & pressure), highlighter, line, arrow, rectangle, ellipse, text, eraser
- **Presentation tools**: laser pointer with fading trail, spotlight, magnifier loupe
- **Privacy tools**: blur/mosaic any region — perfect before screenshots
- **Smart shape recognition**: turns rough strokes into clean primitives (geometric heuristics, no ML — fast and explainable)
- **Multi-monitor**: per-display overlays that respond to display add/remove/resize events
- **Persistent annotations**: save vector drawings to JSON, reload later, export PNG
- **Screen recording**: WebM (VP9) or animated GIF, with optional pause/resume
- **Floating toolbar**: dark-glass UI, drag anywhere, full keyboard shortcuts
- **System tray** entry so InkOver lives quietly until summoned
- **Global hotkeys**: `Cmd/Ctrl+Shift+P` toggles annotation, `Cmd/Ctrl+Shift+R` toggles recording

## Keyboard shortcuts

While the overlay is active:

| Key | Action |
| --- | --- |
| `P` | Pen |
| `H` | Highlighter |
| `L` / `A` | Line / Arrow |
| `R` / `O` | Rectangle / Ellipse |
| `T` | Text |
| `J` | Laser pointer |
| `S` | Spotlight |
| `M` | Magnifier |
| `B` | Blur |
| `X` | Eraser |
| `V` | Click-through (interact with desktop) |
| `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` | Undo / Redo |
| `Cmd/Ctrl+S` | Save drawing |
| `Cmd/Ctrl+E` | Export PNG |
| `Esc` | Hide overlay |

Holding **Shift** while dragging a line/arrow constrains to 45° steps; holding it while dragging a rectangle/ellipse keeps it square/circular.

## Architecture

```
src/
├── main/                ← Electron main process
│   ├── index.ts         ← App bootstrap + IPC handlers
│   ├── overlay-manager  ← One transparent overlay window per display
│   ├── toolbar-window   ← Floating draggable toolbar
│   ├── shortcuts        ← Global hotkey registration
│   ├── tray             ← System tray menu
│   ├── store            ← Settings + drawing persistence
│   └── recorder         ← Screen capture orchestration
├── preload/             ← Typed contextBridge API → window.inkover
├── renderer/
│   ├── overlay.html     ← Transparent canvas, full screen
│   ├── toolbar.html     ← Floating toolbar window
│   ├── canvas-engine    ← Vector renderer with hit testing
│   ├── history          ← Linear undo/redo
│   ├── tools/           ← Pen, shapes, text, laser, spotlight, magnifier, blur, eraser
│   ├── recognition/     ← Geometric shape recognizer (line/arrow/rect/ellipse)
│   └── recorder-page    ← MediaRecorder + dependency-free GIF89a encoder
└── shared/              ← Types and IPC channel constants
```

The split between `main` and `renderer` follows Electron best practices: nothing in the renderer touches Node directly. All privileged work goes through a typed preload bridge so the renderer can be sandboxed without losing functionality.

## Build & run

```bash
# Install
npm install

# Dev mode (hot-reload renderer + main)
npm run dev

# Production build
npm run build && npm start

# Package distributables for your platform
npm run package        # all that match the host
npm run package:mac    # .dmg
npm run package:win    # .exe (NSIS)
npm run package:linux  # .AppImage + .deb
```

## Permissions

- **macOS**: first run will request *Screen Recording* permission (needed for `desktopCapturer`). Without it, the magnifier and screen-recording features won't work, but drawing still does. *Accessibility* permission is **not** required because InkOver doesn't synthesize input events.
- **Windows**: no special permissions.
- **Linux** (Wayland): screen capture works on GNOME/KDE via PipeWire. On X11 it works via XComposite.

## Implementation notes

A few decisions that may surprise you when reading the code:

- **Recognition is heuristic, not learned.** The `auto-shape.ts` module uses closed-form geometric features (closure ratio, radius variance, corner detection). A trained recognizer like $1 was considered but heuristics are faster, fully explainable, and have failure modes the user can predict.
- **Blur uses CSS `backdrop-filter`, not canvas pixels.** The canvas stays transparent in blur regions and a separate DOM layer with `backdrop-filter: blur()` handles the mosaic. This keeps the underlying screen pixels live without us ever needing to read them — friendly to the OS and free of permission requests.
- **GIF encoder is inline.** It uses median-cut palette quantization and a standard LZW packer. Slow on long recordings but dependency-free, ~250 lines, and easy to read.
- **Click-through is per-tool.** When the user picks the *Select* tool the overlay flips into `setIgnoreMouseEvents(true, { forward: true })` so the underlying desktop is interactive again — but the renderer still gets `mousemove` events, so the laser and spotlight follow the cursor in passthrough mode.

## Roadmap

- [ ] Pen pressure on Wacom/Apple Pencil (currently uses `PointerEvent.pressure` which works but isn't tablet-aware)
- [ ] Annotation layer baked directly into the recorded video (currently only the captured screen is recorded)
- [ ] Cloud sharing of drawings via signed URLs
- [ ] Plugin API for custom tools

## License

MIT
