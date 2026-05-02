// Blur tool: drag a rectangle, and within it the underlying screen content is
// pixelated/mosaicked. This is the "redact PII before screenshot" feature.
//
// Implementation: each blur shape is rendered as a DOM element with a
// `backdrop-filter: blur()` applied, layered behind the canvas. The canvas
// itself stays transparent in those regions so the blurred backdrop shows
// through. We track DOM nodes alongside shape ids so the engine doesn't
// need to know about CSS.

import type { Shape } from "@shared/types";
import type { Tool, ToolContext, PointerEvent } from "./base";
import { newId } from "./base";

export class BlurTool implements Tool {
  id = "blur";
  cursor = "crosshair";
  private start: { x: number; y: number } | null = null;
  private current: { x: number; y: number } | null = null;
  private previewEl: HTMLDivElement | null = null;

  onPointerDown(ev: PointerEvent, _ctx: ToolContext): void {
    this.start = ev.pos;
    this.current = ev.pos;
    this.previewEl = document.createElement("div");
    this.previewEl.className = "inkover-blur-preview";
    this.previewEl.style.position = "fixed";
    this.previewEl.style.border = "1px dashed rgba(255,255,255,0.7)";
    this.previewEl.style.background = "rgba(255,255,255,0.05)";
    this.previewEl.style.backdropFilter = "blur(12px) saturate(0.6)";
    (this.previewEl.style as any).webkitBackdropFilter = "blur(12px) saturate(0.6)";
    this.previewEl.style.pointerEvents = "none";
    this.previewEl.style.zIndex = "1";
    document.body.appendChild(this.previewEl);
    this.updatePreview();
  }
  onPointerMove(ev: PointerEvent): void {
    if (!this.start) return;
    this.current = ev.pos;
    this.updatePreview();
  }
  onPointerUp(_ev: PointerEvent, ctx: ToolContext): void {
    if (!this.start || !this.current) return;
    const x = Math.min(this.start.x, this.current.x);
    const y = Math.min(this.start.y, this.current.y);
    const w = Math.abs(this.current.x - this.start.x);
    const h = Math.abs(this.current.y - this.start.y);
    this.previewEl?.remove();
    this.previewEl = null;
    this.start = this.current = null;
    if (w < 4 || h < 4) return;
    const shape: Shape = { id: newId(), kind: "blur", x, y, w, h, intensity: 12 };
    ctx.engine.addShape(shape);
    ctx.history.push(ctx.engine.getShapes());
    // Spawn the persistent backdrop element.
    BlurLayer.attach(shape);
  }

  private updatePreview(): void {
    if (!this.previewEl || !this.start || !this.current) return;
    const x = Math.min(this.start.x, this.current.x);
    const y = Math.min(this.start.y, this.current.y);
    const w = Math.abs(this.current.x - this.start.x);
    const h = Math.abs(this.current.y - this.start.y);
    Object.assign(this.previewEl.style, {
      left: x + "px",
      top: y + "px",
      width: w + "px",
      height: h + "px",
    });
  }
}

/**
 * Manages the DOM elements that visualize committed blur shapes. We keep this
 * separate so the canvas engine doesn't need to know about DOM lifecycle.
 */
export const BlurLayer = {
  /** Map shape id → DOM element. */
  nodes: new Map<string, HTMLDivElement>(),

  attach(s: Shape & { kind: "blur" }): void {
    const div = document.createElement("div");
    div.className = "inkover-blur-region";
    div.dataset.shapeId = s.id;
    Object.assign(div.style, {
      position: "fixed",
      left: s.x + "px",
      top: s.y + "px",
      width: s.w + "px",
      height: s.h + "px",
      pointerEvents: "none",
      zIndex: "1",
      backdropFilter: `blur(${s.intensity}px) saturate(0.6)`,
      borderRadius: "2px",
    });
    (div.style as any).webkitBackdropFilter = `blur(${s.intensity}px) saturate(0.6)`;
    document.body.appendChild(div);
    BlurLayer.nodes.set(s.id, div);
  },

  detach(id: string): void {
    const el = BlurLayer.nodes.get(id);
    if (el) {
      el.remove();
      BlurLayer.nodes.delete(id);
    }
  },

  syncTo(shapes: Shape[]): void {
    const ids = new Set(shapes.filter((s) => s.kind === "blur").map((s) => s.id));
    for (const id of [...BlurLayer.nodes.keys()]) {
      if (!ids.has(id)) BlurLayer.detach(id);
    }
    for (const s of shapes) {
      if (s.kind === "blur" && !BlurLayer.nodes.has(s.id)) BlurLayer.attach(s);
    }
  },
};
