// CanvasEngine renders an array of vector shapes onto a 2D canvas and provides
// helpers for tools to register active strokes / previews.
//
// Two layers in one canvas:
//   1. Persistent layer  → committed shapes, drawn from `this.shapes`
//   2. Preview layer     → the currently-drawing stroke or shape, drawn each frame
//                          from `this.preview`
//
// The committed layer is cached into an off-DOM canvas so pointer-move updates
// only redraw the active preview instead of replaying the entire shape list.

import type { Point, Rect, Shape, StrokeStyle } from "@shared/types";

export class CanvasEngine {
  private ctx: CanvasRenderingContext2D;
  private persistentCanvas: HTMLCanvasElement;
  private persistentCtx: CanvasRenderingContext2D;
  private shapes: Shape[] = [];
  /** Transient shape being authored by the active tool. */
  private preview: Shape | null = null;
  /** Screen-space rectangle to keep visually clear for the floating toolbar. */
  private excludedRect: Rect | null = null;
  /** DPR-aware logical size. */
  private width = 0;
  private height = 0;
  private dpr = 1;
  private persistentDirty = true;
  /** Throttled render via rAF. */
  private rafId: number | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D canvas unavailable");
    const persistentCanvas = document.createElement("canvas");
    const persistentCtx = persistentCanvas.getContext("2d", { alpha: true });
    if (!persistentCtx) throw new Error("persistent 2D canvas unavailable");
    this.ctx = ctx;
    this.persistentCanvas = persistentCanvas;
    this.persistentCtx = persistentCtx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = dpr;
    configureCanvasSurface(this.canvas, this.ctx, w, h, dpr);
    configureCanvasSurface(this.persistentCanvas, this.persistentCtx, w, h, dpr);
    this.width = w;
    this.height = h;
    this.persistentDirty = true;
    this.requestRender();
  }

  // ---- Shape API ---------------------------------------------------------

  getShapes(): Shape[] {
    return this.shapes;
  }

  setShapes(shapes: Shape[]): void {
    this.shapes = shapes;
    this.persistentDirty = true;
    this.requestRender();
  }

  addShape(s: Shape): void {
    this.shapes.push(s);
    this.persistentDirty = true;
    this.requestRender();
  }

  /** Replace the last shape — used by recognition to swap a rough stroke for a clean one. */
  replaceLast(s: Shape): void {
    if (this.shapes.length === 0) return;
    this.shapes[this.shapes.length - 1] = s;
    this.persistentDirty = true;
    this.requestRender();
  }

  removeShape(id: string): void {
    const i = this.shapes.findIndex((s) => s.id === id);
    if (i >= 0) {
      this.shapes.splice(i, 1);
      this.persistentDirty = true;
      this.requestRender();
    }
  }

  clear(): void {
    this.shapes = [];
    this.preview = null;
    this.persistentDirty = true;
    this.requestRender();
  }

  setPreview(s: Shape | null): void {
    this.preview = s;
    this.requestRender();
  }

  setExcludedRect(rect: Rect | null): void {
    this.excludedRect = rect;
    this.requestRender();
  }

  size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  renderTo(targetCtx: CanvasRenderingContext2D, opts?: { includePreview?: boolean }): void {
    targetCtx.clearRect(0, 0, this.width, this.height);
    for (const shape of this.shapes) this.drawShape(targetCtx, shape);
    if (opts?.includePreview && this.preview) this.drawShape(targetCtx, this.preview);
  }

  /** Best-effort hit testing for the eraser tool. */
  hitTest(x: number, y: number, tolerance = 8): Shape | null {
    // Iterate in reverse so the topmost shape wins.
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      if (this.shapeHit(s, x, y, tolerance)) return s;
    }
    return null;
  }

  // ---- Rendering ---------------------------------------------------------

  private requestRender(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private render(): void {
    const { ctx, width, height } = this;
    if (this.persistentDirty) this.repaintPersistentLayer();
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.persistentCanvas, 0, 0, width, height);
    if (this.preview) this.drawShape(ctx, this.preview);
    if (this.excludedRect) {
      ctx.clearRect(
        this.excludedRect.x,
        this.excludedRect.y,
        this.excludedRect.width,
        this.excludedRect.height,
      );
    }
  }

  private repaintPersistentLayer(): void {
    const { persistentCtx, width, height } = this;
    persistentCtx.clearRect(0, 0, width, height);
    for (const shape of this.shapes) this.drawShape(persistentCtx, shape);
    this.persistentDirty = false;
  }

  private drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
    ctx.save();
    if (s.kind === "blur") {
      // Blur is rendered as a frosted overlay rectangle; the renderer-side
      // capture-bg layer (overlay.html) sits behind us and a CSS backdrop-filter
      // does the heavy lifting. Here we just stamp a tinted rectangle so the
      // bounds are visible while drawing. We rely on the DOM layer for the
      // actual mosaic effect — see overlay.html.
      ctx.fillStyle = "rgba(255,255,255,0.0)";
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.restore();
      return;
    }
    applyStyle(ctx, s.style);
    switch (s.kind) {
      case "stroke":
        drawStroke(ctx, s.points, s.style);
        break;
      case "line":
        ctx.beginPath();
        ctx.moveTo(s.from.x, s.from.y);
        ctx.lineTo(s.to.x, s.to.y);
        ctx.stroke();
        break;
      case "arrow":
        drawArrow(ctx, s.from, s.to, s.style);
        break;
      case "rect":
        if (s.style.fill) {
          ctx.fillStyle = s.style.fill;
          ctx.fillRect(s.x, s.y, s.w, s.h);
        }
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        break;
      case "ellipse":
        ctx.beginPath();
        ctx.ellipse(s.cx, s.cy, Math.abs(s.rx), Math.abs(s.ry), 0, 0, Math.PI * 2);
        if (s.style.fill) {
          ctx.fillStyle = s.style.fill;
          ctx.fill();
        }
        ctx.stroke();
        break;
      case "text":
        ctx.fillStyle = s.style.color;
        ctx.font = `${s.size}px ${s.font}`;
        ctx.textBaseline = "top";
        for (const [i, line] of s.text.split("\n").entries()) {
          ctx.fillText(line, s.x, s.y + i * s.size * 1.25);
        }
        break;
    }
    ctx.restore();
  }

  // ---- Hit helpers -------------------------------------------------------

  private shapeHit(s: Shape, x: number, y: number, tol: number): boolean {
    switch (s.kind) {
      case "stroke":
        return s.points.some((p) => Math.hypot(p.x - x, p.y - y) <= Math.max(tol, s.style.width));
      case "line":
        return distToSegment(x, y, s.from, s.to) <= Math.max(tol, s.style.width);
      case "arrow":
        return distToSegment(x, y, s.from, s.to) <= Math.max(tol, s.style.width);
      case "rect":
        return x >= s.x - tol && x <= s.x + s.w + tol && y >= s.y - tol && y <= s.y + s.h + tol;
      case "ellipse": {
        const dx = (x - s.cx) / Math.max(1, Math.abs(s.rx));
        const dy = (y - s.cy) / Math.max(1, Math.abs(s.ry));
        return Math.abs(dx * dx + dy * dy - 1) < 0.25;
      }
      case "text":
        // Approximate width: char-count * 0.6 * size.
        return (
          x >= s.x - tol &&
          x <= s.x + s.text.length * s.size * 0.6 + tol &&
          y >= s.y - tol &&
          y <= s.y + s.size + tol
        );
      case "blur":
        return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    }
  }
}

// ---- Drawing primitives --------------------------------------------------

function configureCanvasSurface(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
): void {
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function applyStyle(ctx: CanvasRenderingContext2D, st: StrokeStyle): void {
  ctx.strokeStyle = st.color;
  ctx.lineWidth = st.width;
  ctx.globalAlpha = st.opacity;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (st.dash && st.dash.length) ctx.setLineDash(st.dash);
}

function drawStroke(ctx: CanvasRenderingContext2D, points: Point[], st: StrokeStyle): void {
  if (points.length < 2) {
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, st.width / 2, 0, Math.PI * 2);
      ctx.fillStyle = st.color;
      ctx.fill();
    }
    return;
  }
  // Catmull-Rom-ish smoothing using midpoint quadratic curves, which is the
  // technique that makes apps like Apple Notes feel buttery.
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const n = points[i + 1];
    const mx = (p.x + n.x) / 2;
    const my = (p.y + n.y) / 2;
    ctx.quadraticCurveTo(p.x, p.y, mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, st: StrokeStyle): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  // Arrowhead — sized proportional to stroke width so it scales naturally.
  const head = Math.max(10, st.width * 4);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(to.x - head * 0.7 * Math.cos(angle), to.y - head * 0.7 * Math.sin(angle));
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fillStyle = st.color;
  ctx.fill();
}

function distToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - a.x, y - a.y);
  let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
