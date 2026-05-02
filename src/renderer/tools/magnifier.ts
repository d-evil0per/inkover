// Magnifier: a circular loupe that follows the cursor and shows a 2x zoomed
// view of the desktop underneath. Because our overlay is transparent and
// click-through-able, we capture the screen via desktopCapturer once, set it
// as a fixed-size <video> background, and use background-position math to
// "look through" the loupe.
//
// We snapshot a single frame on activation (cheap) rather than streaming —
// streaming would force the underlying screen into capture mode and cause
// permission prompts. For a presentation aid, a frozen snapshot is usually
// what you want anyway.

import type { Tool, PointerEvent } from "./base";

export class MagnifierTool implements Tool {
  id = "magnifier";
  cursor = "none";
  animates = true;
  private layer: HTMLDivElement | null = null;
  private snapshotUrl: string | null = null;
  private x = 0;
  private y = 0;
  private radius = 90;
  private zoom = 2;

  async onActivate(): Promise<void> {
    const div = document.createElement("div");
    div.className = "inkover-magnifier-layer";
    div.style.position = "fixed";
    div.style.pointerEvents = "none";
    div.style.zIndex = "9997";
    div.style.borderRadius = "50%";
    div.style.boxShadow = "0 6px 20px rgba(0,0,0,0.4), inset 0 0 0 3px rgba(255,255,255,0.6)";
    div.style.backgroundRepeat = "no-repeat";
    document.body.appendChild(div);
    this.layer = div;

    // Acquire a screen snapshot. We ask main for the available sources and pick
    // the screen that contains our overlay. This is a renderer-side getUserMedia
    // call gated by chromeMediaSourceId.
    try {
      const sources = await window.inkover.getCaptureSources();
      const screenSrc = sources.find((s) => s.id.startsWith("screen:")) ?? sources[0];
      if (!screenSrc) return;
      // We can't use `chromeMediaSource` without `getUserMedia` — but we already have a
      // thumbnail data URL from desktopCapturer. For a magnifier, the thumbnail
      // resolution is fine because we only zoom 2x within a small loupe.
      this.snapshotUrl = screenSrc.thumbnail;
      this.update();
    } catch (err) {
      console.warn("[magnifier] snapshot failed", err);
    }
  }

  onDeactivate(): void {
    this.layer?.remove();
    this.layer = null;
    this.snapshotUrl = null;
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

  private update(): void {
    if (!this.layer) return;
    const r = this.radius;
    this.layer.style.left = this.x - r + "px";
    this.layer.style.top = this.y - r + "px";
    this.layer.style.width = r * 2 + "px";
    this.layer.style.height = r * 2 + "px";
    if (this.snapshotUrl) {
      this.layer.style.backgroundImage = `url(${this.snapshotUrl})`;
      // Scale the snapshot to the screen size, then zoom in.
      const sw = window.innerWidth * this.zoom;
      const sh = window.innerHeight * this.zoom;
      this.layer.style.backgroundSize = `${sw}px ${sh}px`;
      // Center the zoomed image on the cursor.
      const bx = -this.x * this.zoom + r;
      const by = -this.y * this.zoom + r;
      this.layer.style.backgroundPosition = `${bx}px ${by}px`;
    } else {
      this.layer.style.background = "rgba(255,255,255,0.1)";
    }
  }
}
