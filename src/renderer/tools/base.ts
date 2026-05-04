// Tool interface. A tool sees pointer events and decides what to do with them —
// add a shape, mutate the preview, etc. The CanvasEngine doesn't know about tools;
// tools call the engine's API.

import type { CanvasEngine } from "../canvas-engine";
import type { History } from "../history";
import type { Point, StrokeStyle } from "@shared/types";

export interface ToolContext {
  engine: CanvasEngine;
  history: History;
  /** Current global stroke style — tools should clone, not mutate. */
  style: () => StrokeStyle;
}

export interface PointerEvent {
  pos: Point;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  pressure: number;
  /** Time since the tool was activated, in ms. Useful for laser/spotlight fades. */
  t: number;
}

export interface Tool {
  id: string;
  /** Cursor CSS string, e.g. "crosshair". */
  cursor: string;
  /** Some tools (laser, spotlight) want continuous redraws even without pointer events. */
  animates?: boolean;

  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;

  onPointerDown(ev: PointerEvent, ctx: ToolContext): void;
  onPointerMove(ev: PointerEvent, ctx: ToolContext): void;
  onPointerUp(ev: PointerEvent, ctx: ToolContext): void;

  /** Called once per frame for animated tools (laser, spotlight follow). */
  onFrame?(ctx: ToolContext, dt: number): void;

  /** Optional special-key handling (Escape, Enter, etc.). */
  onKey?(key: string, ctx: ToolContext): boolean;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 11);
}
