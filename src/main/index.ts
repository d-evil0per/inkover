// Main process entry. Wires together:
//   - Persistent settings (Store)
//   - Per-monitor overlay windows (OverlayManager)
//   - Floating toolbar window (ToolbarWindow)
//   - Global hotkeys (ShortcutManager)
//   - System tray (TrayController)
//   - Screen recording (Recorder)
//   - Typed IPC handlers
//
// Architectural goal: every concern has a single owner and the wiring sits here.
// If you're tracing a bug, this file should let you find the right module fast.

import { app, BrowserWindow, ipcMain, dialog, screen, session } from "electron";
import { join } from "path";
import { pathToFileURL } from "url";
import { promises as fs } from "fs";
import { Store } from "./store";
import { OverlayManager } from "./overlay-manager";
import { ToolbarWindow } from "./toolbar-window";
import { ShortcutManager } from "./shortcuts";
import { TrayController } from "./tray";
import { Recorder } from "./recorder";
import { APP_ID } from "./app-icon";
import { IPC } from "../shared/ipc-channels";
import type { Rect, Settings, ToolId, StrokeStyle, DrawingSnapshot, ExportFormat } from "../shared/types";

// ---- Configuration ---------------------------------------------------------

// `npm start` runs unpackaged code from dist/, so `app.isPackaged` is not a
// reliable dev/prod discriminator here. Only opt into the Vite dev server when
// the dev script explicitly asks for it.
const isDev = process.env.INKOVER_DEV === "1";
const rendererBaseUrl = isDev
  ? process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173"
  : pathToFileURL(join(__dirname, "..", "renderer")).toString();
const preloadPath = join(__dirname, "..", "preload", "index.js");

console.log(`[main] mode=${isDev ? "dev" : "prod"}, renderer=${rendererBaseUrl}, preload=${preloadPath}`);

// ---- Singleton lock --------------------------------------------------------
// Prevents two InkOver processes fighting over the same global hotkey.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

// On macOS we don't want a Dock icon — InkOver lives in the menu bar.
if (process.platform === "darwin") {
  app.dock?.hide();
}

// ---- Bootstrap -------------------------------------------------------------

class App {
  private store = new Store();
  private overlays = new OverlayManager({ rendererBaseUrl, preloadPath });
  private toolbar = new ToolbarWindow({ rendererBaseUrl, preloadPath });
  private shortcuts = new ShortcutManager();
  private tray = new TrayController();
  private recorder: Recorder;

  // We track currentTool/style here so overlays joining late (e.g. on a newly
  // attached monitor) can be told the latest values.
  private currentTool: ToolId = "select";
  private currentStyle: StrokeStyle;

  constructor() {
    this.currentStyle = this.store.get().defaultStyle;
    this.recorder = new Recorder({
      rendererBaseUrl,
      currentDisplayId: () => this.toolbar.getCurrentDisplayId(),
      defaultDir: () => this.store.get().recordings.saveDir,
    });
  }

  async start(): Promise<void> {
    await app.whenReady();
    this.recorder.installSessionHandlers(session.defaultSession);
    await this.store.init();
    this.currentStyle = this.store.get().defaultStyle;

    this.overlays.start();
    this.toolbar.open();
    this.toolbar.onDisplayChange((displayId) => {
      this.overlays.setActiveDisplay(displayId);
      this.syncToolbarBounds();
      this.toolbar.bringToFront();
    });
    this.toolbar.onBoundsChange(() => this.syncToolbarBounds());
    this.toolbar.onClosed(() => {
      this.overlays.hide();
      this.syncVisibilityState();
      this.syncToolbarBounds();
      this.tray.refresh(this.trayHandlers());
    });
    // Show the overlay immediately on first launch so users can see it works.
    // (Easy to hide via the toolbar ✕ button or Esc.)
    this.overlays.show(this.toolbar.getCurrentDisplayId());
    this.syncVisibilityState();
    this.syncToolbarBounds();
    // The overlay sits at "screen-saver" level too; re-bring the toolbar to
    // front so the dock stays clickable above the transparent overlay.
    this.toolbar.bringToFront();

    this.registerShortcuts();
    this.tray.start(this.trayHandlers());
    this.registerIpc();

    this.recorder.onStatus((s) => {
      this.broadcast(IPC.OnRecorderStatus, s);
      this.tray.refresh(this.trayHandlers());
    });

    this.store.onChange((s) => {
      this.broadcast(IPC.OnSettingsChange, s);
      this.registerShortcuts(); // re-bind if hotkeys changed
    });

    // Keep the app alive when no windows are visible — InkOver lives in the tray.
    // Registering any handler here is enough to suppress the default quit on
    // non-macOS platforms; we just don't call app.quit().
    app.on("window-all-closed", () => {});
    app.on("will-quit", () => this.shortcuts.unregisterAll());
  }

  reveal(): void {
    this.toolbar.open();
    this.overlays.show(this.toolbar.getCurrentDisplayId());
    this.syncVisibilityState();
    this.syncToolbarBounds();
    this.toolbar.bringToFront();
  }

  // ---- IPC --------------------------------------------------------------

  private registerIpc(): void {
    ipcMain.handle(IPC.GetSettings, () => this.store.get());
    ipcMain.handle(IPC.UpdateSettings, async (_e, patch: Partial<Settings>) => {
      return this.store.update(patch);
    });
    ipcMain.handle(IPC.GetDisplays, () => this.overlays.getDisplays());
    ipcMain.handle(IPC.GetCursorScreenPoint, () => screen.getCursorScreenPoint());

    // Drawing persistence
    ipcMain.handle(IPC.SaveDrawing, async (_e, snap: DrawingSnapshot) => {
      const path = await this.store.saveDrawing(snap);
      return { path };
    });
    ipcMain.handle(IPC.LoadDrawing, async (_e, path?: string) => {
      if (!path) {
        const r = await dialog.showOpenDialog({
          title: "Open InkOver drawing",
          filters: [{ name: "InkOver drawing", extensions: ["json"] }],
          properties: ["openFile"],
        });
        if (r.canceled || r.filePaths.length === 0) return null;
        path = r.filePaths[0];
      }
      return this.store.loadDrawing(path);
    });
    ipcMain.handle(IPC.ExportImage, async (_e, args: { pngDataUrl: string; suggestedName?: string }) => {
      const b64 = args.pngDataUrl.replace(/^data:image\/\w+;base64,/, "");
      return this.saveExportFile({
        format: "png",
        bytes: Buffer.from(b64, "base64"),
        suggestedName: args.suggestedName,
      });
    });
    ipcMain.handle(IPC.ExportSvg, async (_e, args: { svgMarkup: string; suggestedName?: string }) => {
      return this.saveExportFile({
        format: "svg",
        bytes: args.svgMarkup,
        suggestedName: args.suggestedName,
      });
    });

    // Toolbar coordination — the toolbar window calls these and we re-broadcast.
    ipcMain.handle(IPC.ToolbarSetTool, (_e, tool: ToolId) => {
      this.currentTool = tool;
      const activeDisplayId = this.toolbar.getCurrentDisplayId();
      this.broadcastToActiveOverlay(IPC.OnToolChange, tool, activeDisplayId);
      // Presentation tools follow hover without capturing clicks, so keep the
      // overlay click-through for them as well.
      const clickThrough = tool === "select" || tool === "laser" || tool === "spotlight" || tool === "magnifier";
      this.overlays.setClickThrough(clickThrough);
      // Picking a drawing tool implicitly enters annotation mode — surface the
      // overlay if it's currently hidden so the user can actually draw.
      if (!clickThrough && !this.overlays.isVisible()) {
        this.overlays.show(activeDisplayId);
        this.syncVisibilityState();
      }
      this.syncToolbarBounds();
      this.toolbar.bringToFront();
    });
    ipcMain.handle(IPC.ToolbarSetStyle, (_e, patch: Partial<StrokeStyle>) => {
      this.currentStyle = { ...this.currentStyle, ...patch };
      this.broadcastToActiveOverlay(IPC.OnStyleChange, this.currentStyle, this.toolbar.getCurrentDisplayId());
    });
    ipcMain.handle(IPC.ToolbarUndo, () =>
      this.broadcastToActiveOverlay(IPC.OnHistoryAction, { action: "undo" }, this.toolbar.getCurrentDisplayId()),
    );
    ipcMain.handle(IPC.ToolbarRedo, () =>
      this.broadcastToActiveOverlay(IPC.OnHistoryAction, { action: "redo" }, this.toolbar.getCurrentDisplayId()),
    );
    ipcMain.handle(IPC.ToolbarClear, () =>
      this.broadcastToActiveOverlay(IPC.OnHistoryAction, { action: "clear" }, this.toolbar.getCurrentDisplayId()),
    );
    ipcMain.handle(IPC.ToolbarExport, (_e, request: { format: ExportFormat }) => {
      const activeDisplayId = this.toolbar.getCurrentDisplayId();
      this.broadcastToActiveOverlay(IPC.OnExportRequest, request, activeDisplayId);
      this.toolbar.bringToFront();
      return true;
    });
    ipcMain.handle(IPC.ToolbarToggleVisible, () => {
      this.overlays.toggle(this.toolbar.getCurrentDisplayId());
      this.syncVisibilityState();
      this.toolbar.bringToFront();
    });
    ipcMain.handle(IPC.ToolbarSetVisibleBounds, (_e, bounds: Rect | null) => {
      this.toolbar.setVisibleBounds(
        bounds
          ? {
              x: Math.round(bounds.x),
              y: Math.round(bounds.y),
              width: Math.round(bounds.width),
              height: Math.round(bounds.height),
            }
          : null,
      );
      this.syncToolbarBounds();
    });
    ipcMain.handle(IPC.OverlaySetPointerOverToolbar, (_e, overToolbar: boolean) => {
      this.overlays.setPointerOverToolbar(overToolbar);
    });

    // Recording
    ipcMain.handle(IPC.GetCaptureSources, () => this.recorder.listSources());
    ipcMain.handle(
      IPC.RecordStart,
      (_e, args: string | { sourceId?: string; format?: "webm" | "gif"; displayId?: number | null } | undefined) => {
        const opts = typeof args === "string" ? { sourceId: args } : args ?? {};
        return this.recorder.start({
          sourceId: opts.sourceId,
          format: opts.format,
          displayId: opts.displayId ?? this.toolbar.getCurrentDisplayId(),
        });
      },
    );
    ipcMain.handle(IPC.RecordStop, () => {
      const didStop = this.recorder.stop();
      if (didStop) this.broadcast(IPC.RecordStop, undefined);
    });
    ipcMain.handle(IPC.RecordPause, () => {
      const didPause = this.recorder.pause();
      if (didPause) this.broadcast(IPC.RecordPause, undefined);
    });
    ipcMain.handle(IPC.RecordResume, () => {
      const didResume = this.recorder.resume();
      if (didResume) this.broadcast(IPC.RecordResume, undefined);
    });
    ipcMain.handle(IPC.RecordCaptureFailed, (_e, args: { error?: string }) =>
      this.recorder.captureFailed(args.error),
    );
    ipcMain.handle(
      IPC.RecordSaveBlob,
      (_e, args: { kind: "webm" | "gif"; bytes: ArrayBuffer; suggestedName?: string }) =>
        this.recorder.saveBlob(args.kind, args.bytes, args.suggestedName),
    );
  }

  // ---- Helpers ----------------------------------------------------------

  /** Broadcast to overlay windows AND the toolbar — both want most events. */
  private broadcast(channel: string, payload: unknown): void {
    this.overlays.broadcast(channel, payload);
    const tb = this.toolbar.webContents();
    if (tb) tb.send(channel, payload);
  }

  private broadcastToActiveOverlay(channel: string, payload: unknown, displayId: number | null): void {
    this.overlays.broadcastToDisplay(channel, payload, displayId);
    const tb = this.toolbar.webContents();
    if (tb) tb.send(channel, payload);
  }

  private syncToolbarBounds(): void {
    const displayId = this.toolbar.getCurrentDisplayId();
    const windowBounds = this.toolbar.getBounds();
    const visibleBounds = this.toolbar.getVisibleBounds();
    const display = this.overlays.getDisplays().find((candidate) => candidate.id === displayId);
    let localBounds: Rect | null = null;
    if (windowBounds && display && this.toolUsesToolbarExclusion(this.currentTool)) {
      const toolbarBounds = visibleBounds
        ? {
            x: windowBounds.x + visibleBounds.x,
            y: windowBounds.y + visibleBounds.y,
            width: visibleBounds.width,
            height: visibleBounds.height,
          }
        : windowBounds;
      localBounds = {
        x: toolbarBounds.x - display.bounds.x,
        y: toolbarBounds.y - display.bounds.y,
        width: toolbarBounds.width,
        height: toolbarBounds.height,
      };
    }
    this.overlays.setToolbarExclusionBounds(localBounds);
    this.broadcastToActiveOverlay(IPC.OnToolbarBoundsChange, localBounds, displayId);
  }

  private async saveExportFile(args: {
    format: ExportFormat;
    bytes: Buffer | string;
    suggestedName?: string;
  }): Promise<{ path: string } | null> {
    const saveDir = process.env.INKOVER_SMOKE_SAVE_DIR;
    const ext = args.format;
    const fileName = args.suggestedName ?? `inkover-${Date.now()}.${ext}`;

    if (saveDir) {
      await fs.mkdir(saveDir, { recursive: true });
      const filePath = join(saveDir, fileName);
      await fs.writeFile(filePath, args.bytes);
      return { path: filePath };
    }

    const filterName = args.format === "png" ? "PNG" : "SVG";
    const result = await dialog.showSaveDialog({
      title: `Export annotation as ${filterName}`,
      defaultPath: join(app.getPath("pictures"), fileName),
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return null;

    await fs.writeFile(result.filePath, args.bytes);
    return { path: result.filePath };
  }

  private toolUsesToolbarExclusion(tool: ToolId): boolean {
    return (
      tool === "pen" ||
      tool === "highlighter" ||
      tool === "line" ||
      tool === "arrow" ||
      tool === "rect" ||
      tool === "ellipse" ||
      tool === "text" ||
      tool === "blur" ||
      tool === "eraser"
    );
  }

  private syncVisibilityState(): void {
    this.broadcast(IPC.OnVisibilityChange, { visible: this.overlays.isVisible() });
  }

  private registerShortcuts(): void {
    const s = this.store.get();
    this.shortcuts.register(
      { toggleHotkey: s.toggleHotkey, recordHotkey: s.recordHotkey },
      {
        toggle: () => {
          this.overlays.toggle(this.toolbar.getCurrentDisplayId());
          this.syncVisibilityState();
          this.toolbar.bringToFront();
        },
        toggleRecording: () => {
          const st = this.recorder.getStatus();
          if (st.state === "idle") {
            // Open the record controls via toolbar UI. Starting from there will
            // record the display that currently hosts the toolbar.
            const tb = this.toolbar.webContents();
            tb?.send(IPC.OnRecorderStatus, { ...st, state: "idle", error: "open-picker" });
          } else {
            void this.recorder.stop();
          }
        },
      },
    );
  }

  private trayHandlers() {
    return {
      toggleAnnotate: () => {
        this.overlays.toggle(this.toolbar.getCurrentDisplayId());
        this.syncVisibilityState();
        this.toolbar.bringToFront();
      },
      toggleToolbar: () => this.toolbar.toggle(),
      startRecording: () => {
        const tb = this.toolbar.webContents();
        tb?.send(IPC.OnRecorderStatus, {
          ...this.recorder.getStatus(),
          state: "idle" as const,
          error: "open-picker",
        });
        this.toolbar.show();
      },
      stopRecording: () => {
        void this.recorder.stop();
      },
      isRecording: () => this.recorder.getStatus().state !== "idle",
      isAnnotating: () => this.overlays.isVisible(),
      openSettings: () => {
        // Opening settings could be its own window; for now we surface it in the
        // toolbar with a query param the renderer reads.
        this.toolbar.show();
      },
      quit: () => app.quit(),
    };
  }
}

const appController = new App();

app.on("second-instance", () => {
  void app.whenReady().then(() => appController.reveal());
});

appController.start().catch((err) => {
  console.error("[main] fatal", err);
  app.quit();
});

// Squash the macOS reopen behavior — clicking the (hidden) dock icon should toggle.
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) return;
  appController.reveal();
});
