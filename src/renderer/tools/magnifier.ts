// Magnifier: a circular loupe that follows the cursor and shows a live zoomed
// view of the desktop underneath. We capture the active display via
// getUserMedia + Electron's desktop source id and place a scaled live <video>
// inside the lens so open windows and animated content stay current.

import type { CaptureSourceInfo } from "@shared/types";
import type { Tool, PointerEvent } from "./base";

export class MagnifierTool implements Tool {
  id = "magnifier";
  cursor = "none";
  animates = true;
  private static readonly FOCUS_ANCHOR_X = 0.5;
  private static readonly FOCUS_ANCHOR_Y = 0.76;
  private static readonly LENS_OFFSET_Y = 2.08;
  private layer: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private displaySize = { width: 0, height: 0, scaleFactor: 1 };
  private x = 0;
  private y = 0;
  private radius = 84;
  private zoom = 1.75;

  async onActivate(): Promise<void> {
    this.syncLensSize();

    const div = document.createElement("div");
    div.className = "inkover-magnifier-layer";
    div.style.position = "fixed";
    div.style.pointerEvents = "none";
    div.style.zIndex = "9997";
    div.style.borderRadius = "50%";
    div.style.overflow = "hidden";
    div.style.background = "linear-gradient(180deg, rgba(255,255,255,0.26), rgba(255,255,255,0.06))";
    div.style.border = "1px solid rgba(255,255,255,0.3)";
    div.style.boxShadow = [
      "0 18px 40px rgba(0,0,0,0.32)",
      "inset 0 1px 0 rgba(255,255,255,0.45)",
      "inset 0 0 0 3px rgba(255,255,255,0.12)",
    ].join(", ");
    div.style.backdropFilter = "blur(14px) saturate(1.2)";
    div.style.transform = "translate3d(0, 0, 0)";

    const canvas = document.createElement("canvas");
    canvas.style.width = `${this.radius * 2}px`;
    canvas.style.height = `${this.radius * 2}px`;
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("magnifier canvas unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    div.appendChild(canvas);

    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.pointerEvents = "none";
    video.style.position = "fixed";
    video.style.opacity = "0";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.left = "-99999px";
    video.style.top = "-99999px";
    document.body.appendChild(video);

    document.body.appendChild(div);
    this.layer = div;
    this.canvas = canvas;
    this.ctx = ctx;
    this.video = video;
    this.updateLensPosition();

    try {
      const sources = await window.inkover.getCaptureSources();
      const displays = await window.inkover.getDisplays();
      const overlayDisplayId = Number(new URL(location.href).searchParams.get("displayId"));
      const screenSrc = this.pickDisplaySource(sources, overlayDisplayId);
      const display = displays.find((entry) => entry.id === overlayDisplayId) ?? displays[0];
      if (!screenSrc) return;

      if (display) {
        this.displaySize = {
          width: display.bounds.width,
          height: display.bounds.height,
          scaleFactor: display.scaleFactor,
        };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          cursor: "never",
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: screenSrc.id,
            minWidth: Math.round(this.displaySize.width * this.displaySize.scaleFactor),
            maxWidth: Math.round(this.displaySize.width * this.displaySize.scaleFactor),
            minHeight: Math.round(this.displaySize.height * this.displaySize.scaleFactor),
            maxHeight: Math.round(this.displaySize.height * this.displaySize.scaleFactor),
            maxFrameRate: 30,
          },
        } as unknown as MediaTrackConstraints,
      });

      this.stream = stream;
      video.srcObject = stream;
      video.addEventListener(
        "loadedmetadata",
        () => {
          this.syncLensSize();
          this.renderLens();
        },
        { once: true },
      );
      await video.play().catch(() => undefined);
      this.renderLens();
    } catch (err) {
      console.warn("[magnifier] live capture failed", err);
    }
  }

  onDeactivate(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.ctx = null;
    this.canvas?.remove();
    this.canvas = null;
    this.video?.remove();
    this.video = null;
    this.layer?.remove();
    this.layer = null;
  }

  onPointerDown(ev: PointerEvent): void {
    this.x = ev.pos.x;
    this.y = ev.pos.y;
    this.updateLensPosition();
    this.renderLens();
  }
  onPointerMove(ev: PointerEvent): void {
    this.x = ev.pos.x;
    this.y = ev.pos.y;
    this.updateLensPosition();
  }
  onPointerUp(): void {}

  onFrame(): void {
    this.renderLens();
  }

  private syncLensSize(): void {
    const diameter = this.radius * 2;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas) {
      this.canvas.style.width = `${diameter}px`;
      this.canvas.style.height = `${diameter}px`;
      this.canvas.width = Math.round(diameter * dpr);
      this.canvas.height = Math.round(diameter * dpr);
      this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  private updateLensPosition(): void {
    if (!this.layer) return;
    const r = this.radius;
    const left = this.x - r;
    const top = this.y - r * (1 + MagnifierTool.LENS_OFFSET_Y);
    this.layer.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    this.layer.style.width = r * 2 + "px";
    this.layer.style.height = r * 2 + "px";
  }

  private renderLens(): void {
    if (!this.canvas || !this.ctx || !this.video || this.video.readyState < 2) return;

    const ctx = this.ctx;
    const diameter = this.radius * 2;
    const videoWidth = this.video.videoWidth || Math.round(this.displaySize.width * this.displaySize.scaleFactor);
    const videoHeight = this.video.videoHeight || Math.round(this.displaySize.height * this.displaySize.scaleFactor);
    if (!videoWidth || !videoHeight) return;

    const sourceScaleX = videoWidth / Math.max(1, window.innerWidth);
    const sourceScaleY = videoHeight / Math.max(1, window.innerHeight);
    const sampleWidth = (diameter / this.zoom) * sourceScaleX;
    const sampleHeight = (diameter / this.zoom) * sourceScaleY;
    const sourceX = this.clamp(
      this.x * sourceScaleX - sampleWidth * MagnifierTool.FOCUS_ANCHOR_X,
      0,
      videoWidth - sampleWidth,
    );
    const sourceY = this.clamp(
      this.y * sourceScaleY - sampleHeight * MagnifierTool.FOCUS_ANCHOR_Y,
      0,
      videoHeight - sampleHeight,
    );

    ctx.clearRect(0, 0, diameter, diameter);
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.radius, this.radius, this.radius - 1.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.video, sourceX, sourceY, sampleWidth, sampleHeight, 0, 0, diameter, diameter);
    const gloss = ctx.createLinearGradient(0, 0, 0, diameter);
    gloss.addColorStop(0, "rgba(255,255,255,0.20)");
    gloss.addColorStop(0.42, "rgba(255,255,255,0.04)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, diameter, diameter);
    ctx.restore();
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private pickDisplaySource(sources: CaptureSourceInfo[], overlayDisplayId: number): CaptureSourceInfo | undefined {
    const screenSources = sources.filter((source) => source.id.startsWith("screen:"));
    if (screenSources.length === 0) return sources[0];
    return (
      screenSources.find((source) => source.displayId === overlayDisplayId) ??
      screenSources[0]
    );
  }
}
