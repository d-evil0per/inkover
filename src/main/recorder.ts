// Recorder orchestrates screen capture. The actual MediaRecorder pipeline runs
// in the toolbar renderer; main owns display selection, recorder state, and the
// eventual save dialog.
//
// Electron's display-media request handler lets main grant the monitor that
// currently hosts the toolbar when the toolbar renderer calls
// navigator.mediaDevices.getDisplayMedia. This avoids the older hidden-window
// + chromeMediaSource startup path entirely.

import { app, desktopCapturer, dialog, type Session, type WebContents } from "electron";
import { promises as fs } from "fs";
import { join } from "path";
import type { CaptureSourceInfo, RecorderStatus } from "../shared/types";

export class Recorder {
  private status: RecorderStatus = {
    state: "idle",
    startedAt: null,
    durationMs: 0,
    outputPath: null,
  };
  private listeners = new Set<(s: RecorderStatus) => void>();

  constructor(
    private opts: {
      rendererBaseUrl: string;
      currentDisplayId: () => number | null;
      defaultDir: () => string | null;
    },
  ) {}

  installSessionHandlers(appSession: Session): void {
    const allowPermission = (webContents: WebContents | null, permission: string): boolean => {
      if (!this.isAppContents(webContents)) return false;
      if (permission === "display-capture") return this.isRecorderContents(webContents);
      return true;
    };

    appSession.setPermissionCheckHandler((webContents, permission) => {
      return allowPermission(webContents, permission);
    });

    appSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(allowPermission(webContents, permission));
    });

    appSession.setDisplayMediaRequestHandler((request, callback) => {
      void (async () => {
        if (!request.videoRequested || !this.isRecorderUrl(request.frame?.url ?? "")) {
          callback({});
          return;
        }

        const displayId = this.opts.currentDisplayId();
        const source = await this.resolveDisplaySource(displayId);
        if (!source) {
          console.log(`[recorder] no screen source available for displayId=${displayId ?? "null"}`);
          callback({});
          return;
        }

        console.log(
          `[recorder] granting display media displayId=${displayId ?? "null"} sourceId=${source.id} gesture=${request.userGesture}`,
        );
        callback({ video: source });
      })().catch((error) => {
        console.log(`[recorder] display media grant failed: ${error instanceof Error ? error.message : String(error)}`);
        callback({});
      });
    });
  }

  onStatus(fn: (s: RecorderStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getStatus(): RecorderStatus {
    return this.status;
  }

  async listSources(): Promise<CaptureSourceInfo[]> {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 256, height: 144 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      displayId: s.display_id ? Number(s.display_id) : null,
    }));
  }

  async start(opts?: { sourceId?: string; format?: "webm" | "gif"; displayId?: number | null }): Promise<boolean> {
    if (this.status.state !== "idle") return false;
    const format = opts?.format === "gif" ? "gif" : "webm";
    const displayId = opts?.displayId ?? this.opts.currentDisplayId();
    console.log(`[recorder] start requested format=${format} displayId=${displayId ?? "null"}`);
    this.set({
      state: "recording",
      startedAt: Date.now(),
      durationMs: 0,
      outputPath: null,
    });
    return true;
  }

  stop(): boolean {
    if (this.status.state !== "recording" && this.status.state !== "paused") return false;
    this.set({ ...this.status, state: "encoding", error: undefined });
    return true;
  }

  pause(): boolean {
    if (this.status.state !== "recording") return false;
    this.set({ ...this.status, state: "paused" });
    return true;
  }

  resume(): boolean {
    if (this.status.state !== "paused") return false;
    this.set({ ...this.status, state: "recording" });
    return true;
  }

  captureFailed(error?: string): void {
    this.set({
      state: "idle",
      startedAt: null,
      durationMs: 0,
      outputPath: null,
      error: error ? `Recording failed: ${error}` : "Recording failed to start.",
    });
  }

  /** Called from renderer when encoded bytes are ready. */
  async saveBlob(kind: "webm" | "gif", bytes: ArrayBuffer, suggestedName?: string): Promise<string | null> {
    const allowUnexpectedSave = process.env.INKOVER_SMOKE_MODE === "1";
    if (this.status.state !== "encoding" && !allowUnexpectedSave) {
      const unexpectedStop = this.status.state === "recording" || this.status.state === "paused";
      this.set({
        state: "idle",
        startedAt: null,
        durationMs: 0,
        outputPath: null,
        error: unexpectedStop ? "Recording ended unexpectedly and was not saved." : undefined,
      });
      return null;
    }

    const ext = kind === "gif" ? "gif" : "webm";
    const defaultDir = this.opts.defaultDir() ?? app.getPath("videos");
    const defaultPath = join(defaultDir, suggestedName ?? `inkover-${Date.now()}.${ext}`);
    const smokeSaveDir = process.env.INKOVER_SMOKE_SAVE_DIR;
    if (smokeSaveDir) {
      await fs.mkdir(smokeSaveDir, { recursive: true });
      const smokePath = join(smokeSaveDir, suggestedName ?? `inkover-${Date.now()}.${ext}`);
      await fs.writeFile(smokePath, Buffer.from(bytes));
      this.set({
        state: "idle",
        startedAt: null,
        durationMs: 0,
        outputPath: smokePath,
      });
      return smokePath;
    }
    const result = await dialog.showSaveDialog({
      title: `Save recording (${ext.toUpperCase()})`,
      defaultPath,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) {
      this.set({ state: "idle", startedAt: null, durationMs: 0, outputPath: null });
      return null;
    }
    await fs.writeFile(result.filePath, Buffer.from(bytes));
    this.set({
      state: "idle",
      startedAt: null,
      durationMs: 0,
      outputPath: result.filePath,
    });
    return result.filePath;
  }

  private async resolveDisplaySource(displayId: number | null) {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
    });
    const matched = displayId != null
      ? sources.find((source) => source.display_id && Number(source.display_id) === displayId)
      : undefined;
    return matched ?? sources[0] ?? null;
  }

  private isAppContents(webContents: WebContents | null): boolean {
    return this.isAppUrl(webContents?.getURL() ?? "");
  }

  private isRecorderContents(webContents: WebContents | null): boolean {
    return this.isRecorderUrl(webContents?.getURL() ?? "");
  }

  private isAppUrl(url: string): boolean {
    return url.startsWith(this.opts.rendererBaseUrl);
  }

  private isRecorderUrl(url: string): boolean {
    return this.isAppUrl(url) && url.includes("toolbar.html");
  }

  private set(s: RecorderStatus): void {
    this.status = s;
    for (const l of this.listeners) l(s);
  }
}
