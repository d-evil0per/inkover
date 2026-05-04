// Drag-to-create shape tools: line, arrow, rectangle, ellipse. They all share
// the same flow (down → preview → up → commit) so we factor it into a small
// helper class and let each subclass build the shape from start/end coords.
//
// Holding Shift constrains lines to 0/45/90 degrees and rectangles/ellipses
// to perfect squares/circles — the standard convention.

import type { Point, Shape, StrokeStyle } from "@shared/types";
import type { Tool, ToolContext, PointerEvent } from "./base";
import { newId } from "./base";

abstract class DragShapeTool implements Tool {
  abstract id: string;
  cursor = "crosshair";
  private start: Point | null = null;
  private current: Point | null = null;
  private style: StrokeStyle | null = null;
  private previewId: string | null = null;
  private shift = false;

  onPointerDown(ev: PointerEvent, ctx: ToolContext): void {
    this.start = ev.pos;
    this.current = ev.pos;
    this.style = ctx.style();
    this.previewId = newId();
    this.shift = ev.shift;
    ctx.engine.setPreview(this.build(this.start, this.current, this.style, this.shift, this.previewId));
  }
  onPointerMove(ev: PointerEvent, ctx: ToolContext): void {
    if (!this.start || !this.style || !this.previewId) return;
    this.current = ev.pos;
    this.shift = ev.shift;
    ctx.engine.setPreview(this.build(this.start, this.current, this.style, this.shift, this.previewId));
  }
  onPointerUp(_ev: PointerEvent, ctx: ToolContext): void {
    if (!this.start || !this.current || !this.style) return;
    ctx.engine.setPreview(null);
    const final = this.build(this.start, this.current, this.style, this.shift, newId());
    if (final) {
      ctx.engine.addShape(final);
      ctx.history.push(ctx.engine.getShapes());
    }
    this.start = this.current = this.style = this.previewId = null;
  }

  protected abstract build(a: Point, b: Point, st: StrokeStyle, shift: boolean, id: string): Shape | null;
}

export class LineTool extends DragShapeTool {
  id = "line";
  protected build(a: Point, b: Point, st: StrokeStyle, shift: boolean, id: string) {
    const to = shift ? snapAngle(a, b) : b;
    return { id, kind: "line" as const, from: a, to, style: st };
  }
}

export class ArrowTool extends DragShapeTool {
  id = "arrow";
  protected build(a: Point, b: Point, st: StrokeStyle, shift: boolean, id: string) {
    const to = shift ? snapAngle(a, b) : b;
    return { id, kind: "arrow" as const, from: a, to, style: st };
  }
}

export class RectTool extends DragShapeTool {
  id = "rect";
  protected build(a: Point, b: Point, st: StrokeStyle, shift: boolean, id: string) {
    let x = Math.min(a.x, b.x);
    let y = Math.min(a.y, b.y);
    let w = Math.abs(b.x - a.x);
    let h = Math.abs(b.y - a.y);
    if (shift) {
      const s = Math.max(w, h);
      // Anchor on `a` so dragging up-left vs down-right both work as expected.
      x = b.x < a.x ? a.x - s : a.x;
      y = b.y < a.y ? a.y - s : a.y;
      w = h = s;
    }
    if (w < 1 && h < 1) return null;
    return { id, kind: "rect" as const, x, y, w, h, style: st };
  }
}

export class EllipseTool extends DragShapeTool {
  id = "ellipse";
  protected build(a: Point, b: Point, st: StrokeStyle, shift: boolean, id: string) {
    let cx = (a.x + b.x) / 2;
    let cy = (a.y + b.y) / 2;
    let rx = Math.abs(b.x - a.x) / 2;
    let ry = Math.abs(b.y - a.y) / 2;
    if (shift) {
      const r = Math.max(rx, ry);
      rx = ry = r;
      cx = a.x + Math.sign(b.x - a.x || 1) * r;
      cy = a.y + Math.sign(b.y - a.y || 1) * r;
    }
    if (rx < 1 && ry < 1) return null;
    return { id, kind: "ellipse" as const, cx, cy, rx, ry, style: st };
  }
}

/** Snap an endpoint to the nearest 0/45/90/etc-degree axis. */
function snapAngle(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return b;
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
}
