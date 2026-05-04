// Laser pointer: a glowing trail that follows the cursor and fades over time.
// This tool draws *outside* the persistent shapes layer — laser strokes are
// transient by design and never enter history. We render them on the same
// canvas via `setPreview` and tick `onFrame` to fade them out.

import type { Point } from "@shared/types";
import type { Tool, PointerEvent } from "./base";

interface LaserDot {
  x: number;
  y: number;
  bornAt: number;
}

const FADE_MS = 900;
const MAX_DOTS = 120;
const DOT_RADIUS = 6;

export class LaserTool implements Tool {
  id = "laser";
  cursor = "none";
  animates = true;
  private dots: LaserDot[] = [];
  private overlayEl: HTMLDivElement | null = null;

  onActivate(): void {
    // Use a DOM layer for the laser so we get free CSS box-shadow glow without
    // having to do multi-pass canvas composites every frame.
    const div = document.createElement("div");
    div.className = "inkover-laser-layer";
    div.style.position = "fixed";
    div.style.inset = "0";
    div.style.pointerEvents = "none";
    div.style.zIndex = "9998";
    document.body.appendChild(div);
    this.overlayEl = div;
  }
  onDeactivate(): void {
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.dots = [];
  }
  onPointerDown(ev: PointerEvent): void {
    this.add(ev.pos);
  }
  onPointerMove(ev: PointerEvent): void {
    this.add(ev.pos);
  }
  onPointerUp(): void {}

  onFrame(): void {
    if (!this.overlayEl) return;
    const now = performance.now();
    this.dots = this.dots.filter((d) => now - d.bornAt < FADE_MS);
    // Render: clear and re-stamp. With at most ~120 dots this is cheap.
    this.overlayEl.innerHTML = "";
    for (const d of this.dots) {
      const age = (now - d.bornAt) / FADE_MS; // 0..1
      const alpha = 1 - age;
      const r = DOT_RADIUS * (1 + age * 0.4);
      const dot = document.createElement("div");
      dot.style.position = "absolute";
      dot.style.left = d.x - r + "px";
      dot.style.top = d.y - r + "px";
      dot.style.width = r * 2 + "px";
      dot.style.height = r * 2 + "px";
      dot.style.borderRadius = "50%";
      dot.style.background = `rgba(255, 30, 30, ${alpha})`;
      dot.style.boxShadow = `0 0 ${12 * alpha}px ${4 * alpha}px rgba(255, 30, 30, ${alpha * 0.7})`;
      this.overlayEl.appendChild(dot);
    }
  }

  private add(p: Point): void {
    this.dots.push({ x: p.x, y: p.y, bornAt: performance.now() });
    if (this.dots.length > MAX_DOTS) this.dots.shift();
  }
}
