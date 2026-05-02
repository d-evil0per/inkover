// Highlighter is a pen variant with a wider, semi-transparent stroke. We don't
// run shape recognition on highlighter strokes — people use it to obscure or
// emphasize, not to draw shapes.

import type { Shape, Point } from "@shared/types";
import type { Tool, ToolContext, PointerEvent } from "./base";
import { newId } from "./base";

export class HighlighterTool implements Tool {
  id = "highlighter";
  cursor = "crosshair";
  private points: Point[] = [];
  private active: Shape | null = null;

  onPointerDown(ev: PointerEvent, ctx: ToolContext): void {
    const base = ctx.style();
    this.points = [{ ...ev.pos }];
    this.active = {
      id: newId(),
      kind: "stroke",
      points: this.points,
      style: { ...base, width: Math.max(base.width * 5, 18), opacity: 0.35 },
    };
    ctx.engine.setPreview(this.active);
  }

  onPointerMove(ev: PointerEvent, ctx: ToolContext): void {
    if (!this.active) return;
    this.points.push({ ...ev.pos });
    ctx.engine.setPreview(this.active);
  }

  onPointerUp(_ev: PointerEvent, ctx: ToolContext): void {
    if (!this.active) return;
    ctx.engine.setPreview(null);
    ctx.engine.addShape(this.active);
    ctx.history.push(ctx.engine.getShapes());
    this.active = null;
    this.points = [];
  }
}
