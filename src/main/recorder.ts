// Recorder orchestrates screen capture. The actual capture happens in a hidden
// renderer (where MediaRecorder is available); main coordinates state, exposes
// available sources, and writes the encoded bytes to disk.
//
// Why route through a renderer?
//   - desktopCapturer.getSources() runs in main, but the actual stream
//     (getUserMedia with chromeMediaSource) and MediaRecorder are renderer-side.
//   - GIF encoding (gif.js / a Web Worker) is also renderer-side.
//
// The renderer that performs capture is created on demand and posts encoded
// bytes back to main, which writes them to disk and emits status events.

import { BrowserWindow, desktopCapturer, dialog, app } from "electron";
import { promises as fs } from "fs";
import { join } from "path";
import { IPC } from "../shared/ipc-channels";
import type { RecorderStatus } from "../shared/types";

export class Recorder {
  private status: RecorderStatus = {
    state: "idle",
    startedAt: null,
    durationMs: 0,
    outputPath: null,
  };
  private captureWin: BrowserWindow | null = null;
  private listeners = new Set<(s: RecorderStatus) => void>();

  constructor(
    private opts: {
      rendererBaseUrl: string;
      preloadPath: string;
      defaultDir: () => string | null;
    },
  ) {}

  onStatus(fn: (s: RecorderStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getStatus(): RecorderStatus {
    return this.status;
  }

  async listSources() {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 256, height: 144 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  }

  async start(sourceId: string): Promise<void> {
    if (this.status.state !== "idle") return;
    // Spawn a hidden window that runs the capture page.
    this.captureWin = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      webPreferences: {
        preload: this.opts.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // backgroundThrottling off so the recorder doesn't slow down when window is hidden.
        backgroundThrottling: false,
      },
    });
    await this.captureWin.loadURL(
      `${this.opts.rendererBaseUrl}/toolbar.html?capture=1&sourceId=${encodeURIComponent(sourceId)}`,
    );
    this.set({
      state: "recording",
      startedAt: Date.now(),
      durationMs: 0,
      outputPath: null,
    });
  }

  async stop(): Promise<void> {
    if (this.status.state === "idle") return;
    this.set({ ...this.status, state: "encoding" });
    // The renderer page listens for this channel and finalizes the MediaRecorder.
    this.captureWin?.webContents.send(IPC.RecordStop);
  }

  pause(): void {
    if (this.status.state !== "recording") return;
    this.captureWin?.webContents.send(IPC.RecordPause);
    this.set({ ...this.status, state: "paused" });
  }

  resume(): void {
    if (this.status.state !== "paused") return;
    this.captureWin?.webContents.send(IPC.RecordResume);
    this.set({ ...this.status, state: "recording" });
  }

  /** Called from renderer when encoded bytes are ready. */
  async saveBlob(kind: "webm" | "gif", bytes: ArrayBuffer, suggestedName?: string): Promise<string | null> {
    const ext = kind === "gif" ? "gif" : "webm";
    const defaultDir = this.opts.defaultDir() ?? app.getPath("videos");
    const defaultPath = join(defaultDir, suggestedName ?? `inkover-${Date.now()}.${ext}`);
    const result = await dialog.showSaveDialog({
      title: `Save recording (${ext.toUpperCase()})`,
      defaultPath,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) {
      this.set({ state: "idle", startedAt: null, durationMs: 0, outputPath: null });
      this.cleanupCaptureWindow();
      return null;
    }
    await fs.writeFile(result.filePath, Buffer.from(bytes));
    this.set({
      state: "idle",
      startedAt: null,
      durationMs: 0,
      outputPath: result.filePath,
    });
    this.cleanupCaptureWindow();
    return result.filePath;
  }

  private cleanupCaptureWindow(): void {
    if (this.captureWin && !this.captureWin.isDestroyed()) {
      this.captureWin.destroy();
    }
    this.captureWin = null;
  }

  private set(s: RecorderStatus): void {
    this.status = s;
    for (const l of this.listeners) l(s);
  }
}
