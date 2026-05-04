// Preload runs in an isolated context with both Node and DOM access.
// We expose a deliberately small, typed API to the renderer via contextBridge.
// Anything not on this surface is unreachable from the renderer — that's the point.

import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-channels";
import type {
  CaptureSourceInfo,
  DrawingSnapshot,
  ExportFormat,
  Rect,
  RecorderStatus,
  RuntimeInfo,
  Settings,
  StrokeStyle,
  ToolId,
  DisplayInfo,
} from "../shared/types";

type Unsubscribe = () => void;

const runtimeInfo: RuntimeInfo = {
  smokeMode: process.env.INKOVER_SMOKE_MODE === "1",
};

const subscribe = <T>(channel: string, cb: (value: T) => void): Unsubscribe => {
  const handler = (_e: unknown, value: T) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

const api = {
  // ---- Settings ----
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.GetSettings),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.UpdateSettings, patch),
  onSettingsChange: (cb: (s: Settings) => void) => subscribe<Settings>(IPC.OnSettingsChange, cb),

  // ---- Displays ----
  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.GetDisplays),
  getCursorScreenPoint: (): Promise<{ x: number; y: number }> => ipcRenderer.invoke(IPC.GetCursorScreenPoint),
  getRuntimeInfo: (): RuntimeInfo => runtimeInfo,

  // ---- Drawing persistence ----
  saveDrawing: (snap: DrawingSnapshot): Promise<{ path: string }> =>
    ipcRenderer.invoke(IPC.SaveDrawing, snap),
  loadDrawing: (path?: string): Promise<DrawingSnapshot | null> =>
    ipcRenderer.invoke(IPC.LoadDrawing, path),
  exportImage: (pngDataUrl: string, suggestedName?: string): Promise<{ path: string } | null> =>
    ipcRenderer.invoke(IPC.ExportImage, { pngDataUrl, suggestedName }),
  exportSvg: (svgMarkup: string, suggestedName?: string): Promise<{ path: string } | null> =>
    ipcRenderer.invoke(IPC.ExportSvg, { svgMarkup, suggestedName }),

  // ---- Toolbar coordination (toolbar window calls these; main re-broadcasts to overlays) ----
  setTool: (tool: ToolId) => ipcRenderer.invoke(IPC.ToolbarSetTool, tool),
  setStyle: (style: Partial<StrokeStyle>) => ipcRenderer.invoke(IPC.ToolbarSetStyle, style),
  undo: () => ipcRenderer.invoke(IPC.ToolbarUndo),
  redo: () => ipcRenderer.invoke(IPC.ToolbarRedo),
  clear: () => ipcRenderer.invoke(IPC.ToolbarClear),
  exportDrawing: (format: ExportFormat) => ipcRenderer.invoke(IPC.ToolbarExport, { format }),
  toggleVisible: () => ipcRenderer.invoke(IPC.ToolbarToggleVisible),
  setToolbarVisibleBounds: (bounds: Rect | null) => ipcRenderer.invoke(IPC.ToolbarSetVisibleBounds, bounds),
  setOverlayPointerOverToolbar: (overToolbar: boolean) =>
    ipcRenderer.invoke(IPC.OverlaySetPointerOverToolbar, overToolbar),

  // ---- Overlay subscriptions ----
  onToolChange: (cb: (tool: ToolId) => void) => subscribe<ToolId>(IPC.OnToolChange, cb),
  onStyleChange: (cb: (s: StrokeStyle) => void) => subscribe<StrokeStyle>(IPC.OnStyleChange, cb),
  onToolbarBoundsChange: (cb: (bounds: Rect | null) => void) =>
    subscribe<Rect | null>(IPC.OnToolbarBoundsChange, cb),
  onVisibilityChange: (cb: (v: { visible: boolean }) => void) =>
    subscribe<{ visible: boolean }>(IPC.OnVisibilityChange, cb),
  onHistoryAction: (cb: (a: { action: "undo" | "redo" | "clear" }) => void) =>
    subscribe<{ action: "undo" | "redo" | "clear" }>(IPC.OnHistoryAction, cb),
  onExportRequest: (cb: (request: { format: ExportFormat }) => void) =>
    subscribe<{ format: ExportFormat }>(IPC.OnExportRequest, cb),

  // ---- Screen recording ----
  getCaptureSources: (): Promise<CaptureSourceInfo[]> =>
    ipcRenderer.invoke(IPC.GetCaptureSources),
  recordStart: (args?: { sourceId?: string; format?: "webm" | "gif"; displayId?: number | null }) =>
    ipcRenderer.invoke(IPC.RecordStart, args),
  recordStop: () => ipcRenderer.invoke(IPC.RecordStop),
  recordPause: () => ipcRenderer.invoke(IPC.RecordPause),
  recordResume: () => ipcRenderer.invoke(IPC.RecordResume),
  recordCaptureFailed: (error: string) => ipcRenderer.invoke(IPC.RecordCaptureFailed, { error }),
  /** Renderer streams the encoded webm/gif bytes back to main for disk write. */
  recordSaveBlob: (kind: "webm" | "gif", bytes: ArrayBuffer, suggestedName?: string) =>
    ipcRenderer.invoke(IPC.RecordSaveBlob, { kind, bytes, suggestedName }),
  onRecorderStatus: (cb: (s: RecorderStatus) => void) =>
    subscribe<RecorderStatus>(IPC.OnRecorderStatus, cb),

  // ---- Capture-window control signals --------------------------------------
  // Main pushes these into the toolbar renderer when the user pauses,
  // resumes, or stops an active recording.
  onRecordStopRequest: (cb: () => void) => subscribe<void>(IPC.RecordStop, () => cb()),
  onRecordPauseRequest: (cb: () => void) => subscribe<void>(IPC.RecordPause, () => cb()),
  onRecordResumeRequest: (cb: () => void) => subscribe<void>(IPC.RecordResume, () => cb()),
};

contextBridge.exposeInMainWorld("inkover", api);

export type InkoverAPI = typeof api;
declare global {
  // Available everywhere in renderer code.
  interface Window {
    inkover: InkoverAPI;
  }
}
