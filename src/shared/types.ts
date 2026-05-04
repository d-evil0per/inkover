// Shared type definitions used across main, preload, and renderer processes.
// Keep this file dependency-free (no Node, no DOM types) so it can be imported anywhere.

export type ToolId =
  | "select"
  | "pen"
  | "highlighter"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text"
  | "laser"
  | "spotlight"
  | "magnifier"
  | "blur"
  | "eraser";

/** Stroke style applied to drawn shapes. */
export interface StrokeStyle {
  color: string;       // CSS color
  width: number;       // px
  opacity: number;     // 0..1
  fill?: string | null; // Optional fill color for closed shapes
  dash?: number[] | null; // Line dash pattern, e.g. [6, 4]
}

/** Geometric primitive on the canvas. */
export type Shape =
  | { id: string; kind: "stroke"; points: Point[]; style: StrokeStyle; smoothed?: boolean }
  | { id: string; kind: "line"; from: Point; to: Point; style: StrokeStyle }
  | { id: string; kind: "arrow"; from: Point; to: Point; style: StrokeStyle }
  | { id: string; kind: "rect"; x: number; y: number; w: number; h: number; style: StrokeStyle }
  | { id: string; kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; style: StrokeStyle }
  | { id: string; kind: "text"; x: number; y: number; text: string; font: string; size: number; style: StrokeStyle }
  | { id: string; kind: "blur"; x: number; y: number; w: number; h: number; intensity: number };

export interface Point {
  x: number;
  y: number;
  /** Optional pressure 0..1 for pen tablets / Apple Pencil simulation. */
  p?: number;
  /** Timestamp in ms since stroke start, used for laser fade and recognition. */
  t?: number;
}

/** A snapshot of the drawing surface, used for save/load and undo coalescing. */
export interface DrawingSnapshot {
  version: 1;
  shapes: Shape[];
  bounds: { width: number; height: number };
}

export type ExportFormat = "png" | "svg";

export interface DisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  primary: boolean;
}

export interface CaptureSourceInfo {
  id: string;
  name: string;
  thumbnail: string;
  displayId: number | null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RuntimeInfo {
  smokeMode: boolean;
}

/** Persisted user settings. */
export interface Settings {
  toggleHotkey: string;          // e.g. "CommandOrControl+Shift+P"
  recordHotkey: string;          // e.g. "CommandOrControl+Shift+R"
  defaultStyle: StrokeStyle;
  defaultFont: string;
  laserFadeMs: number;
  recordings: { saveDir: string | null };
  theme: "auto" | "dark" | "light";
}

export const DEFAULT_SETTINGS: Settings = {
  toggleHotkey: "CommandOrControl+Shift+P",
  recordHotkey: "CommandOrControl+Shift+R",
  defaultStyle: { color: "#FF3B30", width: 4, opacity: 1, fill: null, dash: null },
  defaultFont: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  laserFadeMs: 900,
  recordings: { saveDir: null },
  theme: "auto",
};

/** Recording state machine. */
export type RecorderState = "idle" | "starting" | "recording" | "paused" | "encoding";

export interface RecorderStatus {
  state: RecorderState;
  startedAt: number | null;
  durationMs: number;
  outputPath: string | null;
  error?: string;
}
