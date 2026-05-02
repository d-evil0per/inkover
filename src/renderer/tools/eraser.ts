// Eraser deletes whole shapes when you drag across them. We deliberately don't
// implement a "pixel eraser" because our shapes are vectors — partial erasure
// would either rasterize the canvas (losing crispness) or require splitting
// strokes (heavy, surprising). Whole-shape deletion is what every modern
// vector tool does and what users expect.

import type { Tool, ToolContext, PointerEvent } from "./base";

export class EraserTool implements Tool {
  id = "eraser";
  cursor = "cell";
  private dragging = false;

  onPointerDown(ev: PointerEvent, ctx: ToolContext): void {
    this.dragging = true;
    this.eraseAt(ev, ctx);
  }
  onPointerMove(ev: PointerEvent, ctx: ToolContext): void {
    if (this.dragging) this.eraseAt(ev, ctx);
  }
  onPointerUp(_ev: PointerEvent, ctx: ToolContext): void {
    if (this.dragging) ctx.history.push(ctx.engine.getShapes());
    this.dragging = false;
  }
  private eraseAt(ev: PointerEvent, ctx: ToolContext): void {
    const hit = ctx.engine.hitTest(ev.pos.x, ev.pos.y, 12);
    if (hit) ctx.engine.removeShape(hit.id);
  }
}
