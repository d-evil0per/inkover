// Freehand pen with pressure-aware width and adaptive smoothing. The trick to
// making strokes feel good is *not* to push every raw mouse sample into the
// shape — we filter out micro-jitter, drop redundant points along nearly
// collinear segments, and let the canvas engine's quadratic smoothing do the
// rest.

import type { Point, Shape, StrokeStyle } from "@shared/types";
import type { Tool, ToolContext, PointerEvent } from "./base";
import { newId } from "./base";

const MIN_DIST_PX = 1.5;        // ignore samples closer than this to the previous one
const COLINEAR_TOLERANCE = 0.4; // px — drop midpoints that lie this close to a straight line

export class PenTool implements Tool {
  id = "pen";
  cursor = "crosshair";
  private active: Shape | null = null;
  private points: Point[] = [];
  private startedAt = 0;

  onPointerDown(ev: PointerEvent, ctx: ToolContext): void {
    this.startedAt = performance.now();
    this.points = [{ ...ev.pos, t: 0, p: ev.pressure }];
    const style = this.styleFor(ctx.style(), ev.pressure);
    this.active = { id: newId(), kind: "stroke", points: this.points, style };
    ctx.engine.setPreview(this.active);
  }

  onPointerMove(ev: PointerEvent, ctx: ToolContext): void {
    if (!this.active || this.active.kind !== "stroke") return;
    const last = this.points[this.points.length - 1];
    if (Math.hypot(ev.pos.x - last.x, ev.pos.y - last.y) < MIN_DIST_PX) return;
    this.points.push({ ...ev.pos, t: performance.now() - this.startedAt, p: ev.pressure });
    this.simplifyTail();
    ctx.engine.setPreview(this.active);
  }

  onPointerUp(_ev: PointerEvent, ctx: ToolContext): void {
    if (!this.active || this.active.kind !== "stroke") return;
    ctx.engine.setPreview(null);
    ctx.engine.addShape(this.active);
    ctx.history.push(ctx.engine.getShapes());
    this.active = null;
    this.points = [];
  }

  /** Optional: tablet pressure widens the stroke — capped so it stays readable. */
  private styleFor(base: StrokeStyle, pressure: number): StrokeStyle {
    if (pressure <= 0 || pressure === 0.5) return base;
    return { ...base, width: Math.max(1, base.width * (0.6 + pressure * 0.8)) };
  }

  /**
   * Drop the previous-to-last point if it lies on the line between its
   * neighbors (Ramer-Douglas-Peucker for the tail only — cheap O(1) per move).
   */
  private simplifyTail(): void {
    const n = this.points.length;
    if (n < 3) return;
    const a = this.points[n - 3];
    const b = this.points[n - 2];
    const c = this.points[n - 1];
    const d = perpDistance(b, a, c);
    if (d < COLINEAR_TOLERANCE) {
      this.points.splice(n - 2, 1);
    }
  }
}

function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}
