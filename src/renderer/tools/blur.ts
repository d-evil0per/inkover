// Blur tool: drag a rectangle, and within it the underlying screen content is
// sampled from a desktop-capture stream and redrawn into a canvas layer.
//
// Why not CSS `backdrop-filter`? The overlay window is transparent and does not
// contain the underlying desktop pixels in its own DOM tree, so backdrop blur
// has nothing reliable to sample on Windows/Electron. Rendering from an actual
// capture stream gives the blur layer real pixels to work with.

import type { CaptureSourceInfo, DisplayInfo, Shape } from "@shared/types";
import type { Tool, ToolContext, PointerEvent } from "./base";
import { newId } from "./base";

type BlurShape = Extract<Shape, { kind: "blur" }>;
type BlurSurface = {
  element: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rect: BlurShape;
  preview: boolean;
};

const BLUR_INTENSITY = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isBlurShape(shape: Shape): shape is BlurShape {
  return shape.kind === "blur";
}

function rectFromPoints(
  start: { x: number; y: number },
  current: { x: number; y: number },
): BlurShape {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const w = Math.abs(current.x - start.x);
  const h = Math.abs(current.y - start.y);
  return { id: "preview", kind: "blur", x, y, w, h, intensity: BLUR_INTENSITY };
}

function pickDisplaySource(
  sources: CaptureSourceInfo[],
  displays: DisplayInfo[],
): { source: CaptureSourceInfo | undefined; display: DisplayInfo | undefined } {
  const displayIdRaw = new URL(location.href).searchParams.get("displayId");
  const displayId = displayIdRaw ? Number(displayIdRaw) : Number.NaN;
  const display = displays.find((entry) => entry.id === displayId) ?? displays[0];
  const screenSources = sources.filter((source) => source.id.startsWith("screen:"));
  const source = screenSources.find((entry) => entry.displayId === display?.id)
    ?? screenSources[0]
    ?? sources[0];
  return { source, display };
}

function createSurface(preview: boolean): BlurSurface {
  const element = document.createElement("div");
  element.className = preview ? "inkover-blur-preview" : "inkover-blur-region";
  element.dataset.captureState = "pending";
  Object.assign(element.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: "0px",
    height: "0px",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "1",
    borderRadius: preview ? "4px" : "3px",
    background: "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(18,18,24,0.12))",
    boxShadow: preview
      ? "inset 0 0 0 1px rgba(255,255,255,0.72)"
      : "inset 0 0 0 1px rgba(255,255,255,0.22), 0 10px 24px rgba(0,0,0,0.12)",
    border: preview ? "1px dashed rgba(255,255,255,0.72)" : "1px solid rgba(255,255,255,0.16)",
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("blur canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  element.appendChild(canvas);
  document.body.appendChild(element);

  return {
    element,
    canvas,
    ctx,
    rect: { id: preview ? "preview" : "", kind: "blur", x: 0, y: 0, w: 0, h: 0, intensity: BLUR_INTENSITY },
    preview,
  };
}

function updateSurfaceLayout(surface: BlurSurface, rect: BlurShape): void {
  surface.rect = rect;
  Object.assign(surface.element.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  });

  const dpr = window.devicePixelRatio || 1;
  surface.canvas.width = Math.max(1, Math.round(rect.w * dpr));
  surface.canvas.height = Math.max(1, Math.round(rect.h * dpr));
  surface.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  surface.ctx.clearRect(0, 0, rect.w, rect.h);
}

async function createCaptureVideo(): Promise<{ video: HTMLVideoElement; stream: MediaStream } | null> {
  try {
    const [sources, displays] = await Promise.all([
      window.inkover.getCaptureSources(),
      window.inkover.getDisplays(),
    ]);
    const { source, display } = pickDisplaySource(sources, displays);
    if (!source) return null;

    const captureWidth = Math.round((display?.bounds.width ?? window.innerWidth) * (display?.scaleFactor ?? 1));
    const captureHeight = Math.round((display?.bounds.height ?? window.innerHeight) * (display?.scaleFactor ?? 1));
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        cursor: "never",
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: source.id,
          minWidth: captureWidth,
          maxWidth: captureWidth,
          minHeight: captureHeight,
          maxHeight: captureHeight,
          maxFrameRate: 30,
        },
      } as unknown as MediaTrackConstraints,
    });

    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.position = "fixed";
    video.style.left = "-99999px";
    video.style.top = "-99999px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.srcObject = stream;
    document.body.appendChild(video);

    await new Promise<void>((resolve) => {
      if (video.readyState >= 1) {
        resolve();
        return;
      }
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
    await video.play().catch(() => undefined);
    return { video, stream };
  } catch (error) {
    console.warn("[blur] desktop capture failed", error);
    return null;
  }
}

function paintBlur(surface: BlurSurface, video: HTMLVideoElement): void {
  const { rect, ctx } = surface;
  if (rect.w < 1 || rect.h < 1) return;

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) return;

  const scaleX = videoWidth / Math.max(1, window.innerWidth);
  const scaleY = videoHeight / Math.max(1, window.innerHeight);
  const bleed = Math.max(8, Math.ceil(rect.intensity * Math.max(scaleX, scaleY)));
  const sx = clamp(rect.x * scaleX - bleed, 0, Math.max(0, videoWidth - 1));
  const sy = clamp(rect.y * scaleY - bleed, 0, Math.max(0, videoHeight - 1));
  const sw = clamp(rect.w * scaleX + bleed * 2, 1, videoWidth - sx);
  const sh = clamp(rect.h * scaleY + bleed * 2, 1, videoHeight - sy);
  const dx = -(bleed / scaleX);
  const dy = -(bleed / scaleY);
  const dw = rect.w + (bleed * 2) / scaleX;
  const dh = rect.h + (bleed * 2) / scaleY;

  ctx.save();
  ctx.clearRect(0, 0, rect.w, rect.h);
  ctx.filter = `blur(${Math.max(5, rect.intensity * 0.7)}px) saturate(0.72)`;
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.filter = "none";

  const overlay = ctx.createLinearGradient(0, 0, 0, rect.h);
  overlay.addColorStop(0, "rgba(255,255,255,0.14)");
  overlay.addColorStop(1, "rgba(18,18,24,0.16)");
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, rect.w, rect.h);
  ctx.restore();
}

export class BlurTool implements Tool {
  id = "blur";
  cursor = "crosshair";
  private start: { x: number; y: number } | null = null;
  private current: { x: number; y: number } | null = null;

  onDeactivate(): void {
    this.start = null;
    this.current = null;
    BlurLayer.clearPreview();
  }

  onPointerDown(ev: PointerEvent, _ctx: ToolContext): void {
    this.start = ev.pos;
    this.current = ev.pos;
    this.updatePreview();
  }

  onPointerMove(ev: PointerEvent): void {
    if (!this.start) return;
    this.current = ev.pos;
    this.updatePreview();
  }

  onPointerUp(_ev: PointerEvent, ctx: ToolContext): void {
    if (!this.start || !this.current) return;
    const shape = rectFromPoints(this.start, this.current);
    BlurLayer.clearPreview();
    this.start = null;
    this.current = null;
    if (shape.w < 4 || shape.h < 4) return;

    const committedShape: BlurShape = {
      ...shape,
      id: newId(),
    };
    ctx.engine.addShape(committedShape);
    ctx.history.push(ctx.engine.getShapes());
    BlurLayer.attach(committedShape);
  }

  private updatePreview(): void {
    if (!this.start || !this.current) return;
    BlurLayer.showPreview(rectFromPoints(this.start, this.current));
  }
}

/**
 * Blur shapes live as DOM layers below the canvas because the vector engine
 * remains canvas-only. We redraw those layers from a hidden display-capture
 * stream so the blur tool has real desktop pixels to sample.
 */
export const BlurLayer = {
  nodes: new Map<string, BlurSurface>(),
  preview: null as BlurSurface | null,
  captureVideo: null as HTMLVideoElement | null,
  captureStream: null as MediaStream | null,
  capturePending: null as Promise<void> | null,
  captureFailed: false,
  frameId: null as number | null,

  attach(shape: BlurShape): void {
    const surface = this.nodes.get(shape.id) ?? createSurface(false);
    surface.element.dataset.shapeId = shape.id;
    updateSurfaceLayout(surface, shape);
    surface.element.dataset.captureState = this.captureFailed ? "error" : "pending";
    if (!this.nodes.has(shape.id)) this.nodes.set(shape.id, surface);
    void this.ensureCapture();
    this.scheduleFrame();
  },

  detach(id: string): void {
    const surface = this.nodes.get(id);
    if (!surface) return;
    surface.element.remove();
    this.nodes.delete(id);
    this.stopIfIdle();
  },

  syncTo(shapes: Shape[]): void {
    const blurShapes = shapes.filter(isBlurShape);
    const nextIds = new Set(blurShapes.map((shape) => shape.id));

    for (const id of [...this.nodes.keys()]) {
      if (!nextIds.has(id)) this.detach(id);
    }

    for (const shape of blurShapes) {
      const surface = this.nodes.get(shape.id);
      if (surface) {
        updateSurfaceLayout(surface, shape);
        surface.element.dataset.captureState = this.captureFailed ? "error" : "pending";
      } else {
        this.attach(shape);
      }
    }

    if (blurShapes.length > 0) this.scheduleFrame();
  },

  showPreview(rect: BlurShape): void {
    const surface = this.preview ?? createSurface(true);
    updateSurfaceLayout(surface, rect);
    surface.element.dataset.captureState = this.captureFailed ? "error" : "pending";
    this.preview = surface;
    void this.ensureCapture();
    this.scheduleFrame();
  },

  clearPreview(): void {
    if (!this.preview) return;
    this.preview.element.remove();
    this.preview = null;
    this.stopIfIdle();
  },

  renderTo(target: CanvasRenderingContext2D): void {
    for (const surface of this.nodes.values()) {
      if (surface.rect.w < 1 || surface.rect.h < 1) continue;
      target.drawImage(surface.canvas, surface.rect.x, surface.rect.y, surface.rect.w, surface.rect.h);
    }
  },

  refreshLayout(): void {
    for (const surface of this.nodes.values()) updateSurfaceLayout(surface, surface.rect);
    if (this.preview) updateSurfaceLayout(this.preview, this.preview.rect);
    if (this.hasRenderable()) this.scheduleFrame();
  },

  async ensureCapture(): Promise<void> {
    if (this.captureVideo || this.capturePending || this.captureFailed) return;
    this.capturePending = (async () => {
      const result = await createCaptureVideo();
      if (!result) {
        this.captureFailed = true;
        for (const surface of this.nodes.values()) surface.element.dataset.captureState = "error";
        if (this.preview) this.preview.element.dataset.captureState = "error";
        return;
      }

      this.captureVideo = result.video;
      this.captureStream = result.stream;
      this.captureFailed = false;
      this.scheduleFrame();
    })().finally(() => {
      this.capturePending = null;
    });
    await this.capturePending;
  },

  scheduleFrame(): void {
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      this.paintFrame();
    });
  },

  paintFrame(): void {
    if (!this.hasRenderable()) {
      this.stopIfIdle();
      return;
    }

    if (!this.captureVideo || this.captureVideo.readyState < 2) {
      void this.ensureCapture();
      this.scheduleFrame();
      return;
    }

    for (const surface of this.nodes.values()) {
      paintBlur(surface, this.captureVideo);
      surface.element.dataset.captureState = "ready";
    }
    if (this.preview) {
      paintBlur(this.preview, this.captureVideo);
      this.preview.element.dataset.captureState = "ready";
    }
    this.scheduleFrame();
  },

  hasRenderable(): boolean {
    return this.nodes.size > 0 || this.preview !== null;
  },

  stopIfIdle(): void {
    if (this.hasRenderable()) return;
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.captureStream?.getTracks().forEach((track) => track.stop());
    this.captureStream = null;
    this.captureVideo?.remove();
    this.captureVideo = null;
    this.captureFailed = false;
  },
};

window.addEventListener("resize", () => {
  BlurLayer.refreshLayout();
});
