# InkOver

InkOver is a lightweight Electron desktop annotation tool for live demos, reviews, support sessions, and quick markups. It combines a draggable toolbar, per-display transparent overlays, screen recording, drawing persistence, and PNG/SVG export in a small desktop app.

- Draggable, collapsible floating toolbar
- One transparent overlay per display
- Drawing, presentation, privacy, export, and recording tools
- Save/load `.inkover.json` snapshots
- Export PNG and SVG snapshots
- WebM and GIF screen recording
- Keyboard shortcuts in both the overlay and the toolbar
- System tray integration and global hotkeys

---

## Quick start

Prerequisites

- A recent Node.js LTS release
- macOS, Windows, or Linux desktop environment
- On macOS, Screen Recording permission for blur, magnifier, and recording features

Install and run:

```bash
npm install
npm run dev
npm run build && npm start
```

## Why InkOver?

DrawPen is a useful starting point, but InkOver is aimed at day-to-day annotation work where keyboard flow, multi-monitor support, and quick export matter more than a fixed toolbar.

| Pain in DrawPen | What InkOver does instead |
| --- | --- |
| Toolbar is fixed in the menu bar | Floating, draggable, collapsible toolbar window |
| Freehand strokes stay rough | Adaptive smoothing plus dedicated line, arrow, rectangle, and ellipse tools |
| Single-monitor only | One transparent overlay window per display, kept in sync as monitors change |
| No screen recording | Built-in WebM and GIF recording of the current display |
| No fast redaction workflow | Blur/redact tool for capture-backed region obfuscation |
| No spotlight or magnifier | Laser pointer, spotlight, and magnifier are built in |
| Annotations vanish on quit | Save/load `.inkover.json` snapshots and export PNG or SVG snapshots |

## Feature tour

- **Drawing tools**: pass-through/select, pen, highlighter, line, arrow, rectangle, ellipse, text, eraser
- **Presentation tools**: laser pointer with fading trail, spotlight, magnifier loupe
- **Privacy tool**: blur/redact any region on the active display
- **Persistence and export**: save/load `.inkover.json` snapshots, export PNG, export SVG snapshot
- **Screen recording**: WebM or GIF recording of the current display
- **Multi-monitor support**: per-display overlays react to display add/remove/resize events
- **Toolbar workflow**: drag anywhere, collapse when idle, use tool/style/record/export flyouts
- **Keyboard-driven control**: focused shortcuts in overlay and toolbar, plus global hotkeys
- **Tablet/stylus support**: pointer-driven drawing and presentation-tool cursor tracking in click-through mode
- **Tray integration**: launch, annotate, and stop recording from the system tray

## Keyboard shortcuts

### Global hotkeys

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+Shift+P` | Toggle annotation overlay |
| `Cmd/Ctrl+Shift+R` | Open recording controls or stop an active recording |

### Focused shortcuts

These work while the overlay or toolbar window is focused.

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
| `V` | Pass-through / interact with desktop |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Y` or `Cmd/Ctrl+Shift+Z` | Redo |
| `Cmd/Ctrl+S` | Save drawing snapshot |
| `Cmd/Ctrl+E` | Export PNG |
| `Cmd/Ctrl+Shift+E` | Export SVG snapshot |
| `Esc` | Hide or show overlay |

Holding **Shift** while dragging a line or arrow constrains to 45-degree steps. Holding **Shift** while dragging a rectangle or ellipse constrains to a square or circle.

## Architecture

```text
src/
├── main/                ← Electron main process
│   ├── index.ts         ← App bootstrap + IPC handlers
│   ├── overlay-manager  ← One transparent overlay window per display
│   ├── recorder.ts      ← Screen capture orchestration
│   ├── shortcuts.ts     ← Global hotkey registration
│   ├── store.ts         ← Settings + drawing persistence
│   ├── toolbar-window.ts← Floating toolbar window
│   └── tray.ts          ← System tray integration
├── preload/             ← Typed contextBridge API → window.inkover
├── renderer/
│   ├── canvas-engine.ts ← Vector renderer with hit testing and export rendering
│   ├── drawing-export.ts← Snapshot export helpers
│   ├── history.ts       ← Linear undo/redo
│   ├── overlay-app.ts   ← Overlay state, tool dispatch, export handling
│   ├── recorder-page.ts ← WebM/GIF capture pipeline
│   ├── toolbar-app.ts   ← Toolbar UI, flyouts, shortcuts, export/record controls
│   ├── recognition/     ← Geometric shape recognizer (line/arrow/rect/ellipse)
│   ├── styles/          ← Overlay and toolbar styling
│   └── tools/           ← Pen, shapes, text, laser, spotlight, magnifier, blur, eraser
└── shared/              ← Types and IPC channel constants
```

The split between `main` and `renderer` follows Electron best practices: nothing in the renderer touches Node directly. Privileged work goes through a typed preload bridge so the renderer can stay sandbox-friendly without losing functionality.

## Build, run, and validate

```bash
# Install dependencies
npm install

# Dev mode
# - Vite HMR for the renderer
# - automatic Electron restarts for main/preload/shared changes
npm run dev

# Production build + run
npm run build && npm start

# Static checks
npm run lint
npm run typecheck

# Electron smoke test
npm run smoke:e2e

# Package distributables for the host platform
npm run package
npm run package:mac
npm run package:win
npm run package:win:release
npm run package:win:installer
npm run package:win:elevated
npm run package:linux
```

`npm run package` now selects the host platform automatically and keeps the Windows build workstation-friendly on this machine.

`npm run package:win` is the local QA build for this workstation. It keeps Windows executable editing off so the build succeeds without the local symlink-privilege path.

`npm run package:win:release` is the CI-friendly production Windows build. `npm run package:win:installer` is the one-command local production installer path and relaunches in an elevated PowerShell session when Windows needs that privilege.

`npm run package:linux` should run on Linux, and `npm run package:mac` should run on macOS. Those platform-native runs are what you want for customer-facing releases.

## Production releases

Use `.github/workflows/release-builds.yml` for sellable cross-platform builds.

- `workflow_dispatch` creates Windows, Linux, and macOS artifacts on native GitHub runners.
- Pushing a tag such as `v0.1.0` builds those artifacts and attaches them to a GitHub Release automatically.
- The release workflow expects signing and notarization secrets only when you want fully trusted customer distribution:
	- `CSC_LINK`
	- `CSC_KEY_PASSWORD`
	- `APPLE_API_KEY`
	- `APPLE_API_KEY_ID`
	- `APPLE_API_ISSUER`
	- `APPLE_ID`
	- `APPLE_APP_SPECIFIC_PASSWORD`
	- `APPLE_TEAM_ID`

Without those secrets, the workflow still gives you unsigned test artifacts for each OS. With them, it becomes the right path for production distribution.

## Permissions

- **macOS**: Screen Recording permission is required for magnifier, blur, and screen recording. Basic drawing, save/load, and export of ordinary ink still work without it. Accessibility permission is not required.
- **Windows**: no extra permissions are expected.
- **Linux**: capture-backed features rely on PipeWire on Wayland and XComposite on X11.

## Implementation notes

- **Recognition is heuristic, not learned.** `auto-shape.ts` uses closed-form geometric features instead of a trained recognizer.
- **Blur is capture-backed.** Transparent Electron overlays cannot reliably blur desktop pixels with CSS `backdrop-filter`, so blur regions redraw from a desktop-capture stream.
- **Presentation tools stay click-through.** Laser, spotlight, and magnifier keep passthrough behavior and can fall back to global cursor polling so tablet/stylus hover still works.
- **Exports are fidelity-first.** PNG export renders from engine state rather than copying the on-screen canvas, because the visible overlay is intentionally clipped under the toolbar. SVG export currently wraps the same rendered snapshot, so it preserves fidelity but is raster-backed rather than pure vector.
- **Recording currently captures the display only.** Annotations are not yet baked into exported recordings.
- **Dev mode restarts Electron automatically.** `scripts/dev-electron.mjs` waits for fresh main/preload output and restarts Electron when compiled main/preload/shared files change.

## Roadmap

- [ ] Richer tablet pressure and device-specific stylus integration
- [ ] Bake the live annotation layer into recorded video output
- [ ] Offer a pure vector SVG export path for every supported annotation type
- [ ] Cloud sharing of drawings via signed URLs
- [ ] Plugin API for custom tools

## License

MIT
