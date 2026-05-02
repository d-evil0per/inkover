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

import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "path";
import { promises as fs } from "fs";
import { Store } from "./store";
import { OverlayManager } from "./overlay-manager";
import { ToolbarWindow } from "./toolbar-window";
import { ShortcutManager } from "./shortcuts";
import { TrayController } from "./tray";
import { Recorder } from "./recorder";
import { IPC } from "../shared/ipc-channels";
import type { Settings, ToolId, StrokeStyle, DrawingSnapshot } from "../shared/types";

// ---- Configuration ---------------------------------------------------------

// In dev (not packaged) we always load from Vite. We only fall back to file://
// once the app has been packaged, when dist/renderer/ actually exists.
const isDev = !app.isPackaged;
const rendererBaseUrl = isDev
  ? process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173"
  : `file://${join(__dirname, "..", "renderer")}`;
const preloadPath = join(__dirname, "..", "preload", "index.js");

console.log(`[main] mode=${isDev ? "dev" : "prod"}, renderer=${rendererBaseUrl}, preload=${preloadPath}`);

// ---- Singleton lock --------------------------------------------------------
// Prevents two InkOver processes fighting over the same global hotkey.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
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
  private currentTool: ToolId = "pen";
  private currentStyle: StrokeStyle;

  constructor() {
    this.currentStyle = this.store.get().defaultStyle;
    this.recorder = new Recorder({
      rendererBaseUrl,
      preloadPath,
      defaultDir: () => this.store.get().recordings.saveDir,
    });
  }

  async start(): Promise<void> {
    await app.whenReady();
    await this.store.init();
    this.currentStyle = this.store.get().defaultStyle;

    this.overlays.start();
    this.toolbar.open();
    // Show the overlay immediately on first launch so users can see it works.
    // (Easy to hide via the toolbar ✕ button or Esc.)
    this.overlays.show();
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

  // ---- IPC --------------------------------------------------------------

  private registerIpc(): void {
    ipcMain.handle(IPC.GetSettings, () => this.store.get());
    ipcMain.handle(IPC.UpdateSettings, async (_e, patch: Partial<Settings>) => {
      return this.store.update(patch);
    });
    ipcMain.handle(IPC.GetDisplays, () => this.overlays.getDisplays());

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
      const r = await dialog.showSaveDialog({
        title: "Export annotation as PNG",
        defaultPath: args.suggestedName ?? `inkover-${Date.now()}.png`,
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (r.canceled || !r.filePath) return null;
      const b64 = args.pngDataUrl.replace(/^data:image\/\w+;base64,/, "");
      await fs.writeFile(r.filePath, Buffer.from(b64, "base64"));
      return { path: r.filePath };
    });

    // Toolbar coordination — the toolbar window calls these and we re-broadcast.
    ipcMain.handle(IPC.ToolbarSetTool, (_e, tool: ToolId) => {
      this.currentTool = tool;
      this.broadcast(IPC.OnToolChange, tool);
      // Click-through ON for "select"; OFF for any drawing tool so we get pointer events.
      const clickThrough = tool === "select";
      for (const d of this.overlays.getDisplays()) {
        this.overlays.setClickThrough(d.id, clickThrough);
      }
      // Picking a drawing tool implicitly enters annotation mode — surface the
      // overlay if it's currently hidden so the user can actually draw.
      if (!clickThrough && !this.overlays.isVisible()) {
        this.overlays.show();
      }
      this.toolbar.bringToFront();
    });
    ipcMain.handle(IPC.ToolbarSetStyle, (_e, patch: Partial<StrokeStyle>) => {
      this.currentStyle = { ...this.currentStyle, ...patch };
      this.broadcast(IPC.OnStyleChange, this.currentStyle);
    });
    ipcMain.handle(IPC.ToolbarUndo, () => this.broadcast(IPC.OnHistoryAction, { action: "undo" }));
    ipcMain.handle(IPC.ToolbarRedo, () => this.broadcast(IPC.OnHistoryAction, { action: "redo" }));
    ipcMain.handle(IPC.ToolbarClear, () => this.broadcast(IPC.OnHistoryAction, { action: "clear" }));
    ipcMain.handle(IPC.ToolbarToggleVisible, () => {
      this.overlays.toggle();
      this.toolbar.bringToFront();
    });
    ipcMain.handle(IPC.ToolbarResize, (_e, args: { w: number; h?: number }) => {
      // Allow the toolbar renderer to request a minimum width; main enforces
      // the window bounds and performs the actual resize.
      const w = Math.max(220, Math.round(args.w));
      const h = args.h ? Math.round(args.h) : undefined;
      // ToolbarWindow exposes a method to set bounds.
      (this.toolbar as any).setWidth?.(w, h);
    });

    // Recording
    ipcMain.handle(IPC.GetCaptureSources, () => this.recorder.listSources());
    ipcMain.handle(IPC.RecordStart, (_e, sourceId: string) => this.recorder.start(sourceId));
    ipcMain.handle(IPC.RecordStop, () => this.recorder.stop());
    ipcMain.handle(IPC.RecordPause, () => this.recorder.pause());
    ipcMain.handle(IPC.RecordResume, () => this.recorder.resume());
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

  private registerShortcuts(): void {
    const s = this.store.get();
    this.shortcuts.register(
      { toggleHotkey: s.toggleHotkey, recordHotkey: s.recordHotkey },
      {
        toggle: () => {
          this.overlays.toggle();
          this.toolbar.bringToFront();
        },
        toggleRecording: () => {
          const st = this.recorder.getStatus();
          if (st.state === "idle") {
            // Show source picker via toolbar UI — defer to the renderer flow.
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
        this.overlays.toggle();
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

new App().start().catch((err) => {
  console.error("[main] fatal", err);
  app.quit();
});

// Squash the macOS reopen behavior — clicking the (hidden) dock icon should toggle.
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) return;
});
