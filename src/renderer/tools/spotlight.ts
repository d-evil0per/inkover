// Spotlight: dims the entire screen except a circle that follows the cursor.
// We implement this with a DOM div containing a radial-gradient mask — much
// simpler and crisper than redrawing on canvas, and the cursor highlight
// follows in CSS at compositor speed (60fps without firing event handlers).
//
// Shift+scroll changes the radius (a delightful keyboard-friendly affordance).

import type { Tool, PointerEvent } from "./base";

export class SpotlightTool implements Tool {
  id = "spotlight";
  cursor = "crosshair";
  animates = true;
  private layer: HTMLDivElement | null = null;
  private x = 0;
  private y = 0;
  private radius = 140;

  onActivate(): void {
    const div = document.createElement("div");
    div.className = "inkover-spotlight-layer";
    div.style.position = "fixed";
    div.style.inset = "0";
    div.style.pointerEvents = "none";
    div.style.zIndex = "9997";
    div.style.background = "rgba(0,0,0,0.6)";
    document.body.appendChild(div);
    this.layer = div;
    this.update();
    div.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("wheel", this.onWheel, { passive: false });
  }
  onDeactivate(): void {
    this.layer?.remove();
    this.layer = null;
    window.removeEventListener("wheel", this.onWheel);
  }

  onPointerDown(ev: PointerEvent): void {
    this.x = ev.pos.x;
    this.y = ev.pos.y;
    this.update();
  }
  onPointerMove(ev: PointerEvent): void {
    this.x = ev.pos.x;
    this.y = ev.pos.y;
    this.update();
  }
  onPointerUp(): void {}

  private onWheel = (e: WheelEvent) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    this.radius = Math.max(40, Math.min(400, this.radius + (e.deltaY > 0 ? -10 : 10)));
    this.update();
  };

  private update(): void {
    if (!this.layer) return;
    // A radial gradient that's transparent in the middle (the lit circle) and
    // opaque outside, applied as a mask. Using a CSS mask keeps the dimmed
    // backdrop crisp at any DPI.
    const grad = `radial-gradient(circle at ${this.x}px ${this.y}px, transparent 0 ${this.radius - 6}px, rgba(0,0,0,0.7) ${this.radius + 8}px)`;
    this.layer.style.background = grad;
  }
}
