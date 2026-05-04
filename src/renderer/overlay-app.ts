// Overlay renderer — the script attached to overlay.html. It owns the canvas
// engine, the active tool, and the IPC subscriptions that keep tool/style/
// history/visibility in sync with the toolbar and the rest of the app.

import { CanvasEngine } from "./canvas-engine";
import { History } from "./history";
import type { Tool, ToolContext } from "./tools/base";
import { PenTool } from "./tools/pen";
import { HighlighterTool } from "./tools/highlighter";
import { LineTool, ArrowTool, RectTool, EllipseTool } from "./tools/shape-tools";
import { TextTool } from "./tools/text";
import { EraserTool } from "./tools/eraser";
import { LaserTool } from "./tools/laser";
import { SpotlightTool } from "./tools/spotlight";
import { MagnifierTool } from "./tools/magnifier";
import { BlurTool, BlurLayer } from "./tools/blur";
import { DEFAULT_SETTINGS, type DrawingSnapshot, type Rect, type StrokeStyle, type ToolId } from "@shared/types";

// "Select" is a passthrough tool — when active, the overlay window goes click-through
// (handled in main) so the user can interact with the underlying desktop. It's a stub
// here because the renderer doesn't need any logic to "select"; it just stops drawing.
class SelectStub implements Tool {
  id = "select";
  cursor = "default";
  onPointerDown(): void {}
  onPointerMove(): void {}
  onPointerUp(): void {}
}

const canvas = document.getElementById("inkover-canvas") as HTMLCanvasElement;
if (!canvas) throw new Error("overlay canvas missing");
const engine = new CanvasEngine(canvas);
const history = new History();

let style: StrokeStyle = DEFAULT_SETTINGS.defaultStyle;
const ctx: ToolContext = {
  engine,
  history,
  style: () => style,
};

const tools: Record<ToolId, Tool> = {
  select: new SelectStub(),
  pen: new PenTool(),
  highlighter: new HighlighterTool(),
  line: new LineTool(),
  arrow: new ArrowTool(),
  rect: new RectTool(),
  ellipse: new EllipseTool(),
  text: new TextTool(),
  laser: new LaserTool(),
  spotlight: new SpotlightTool(),
  magnifier: new MagnifierTool(),
  blur: new BlurTool(),
  eraser: new EraserTool(),
};

let active: Tool = tools.select;
active.onActivate?.(ctx);
let toolbarBounds: Rect | null = null;
let activePointerId: number | null = null;
let lastAcceptedPointerEvent: import("./tools/base").PointerEvent | null = null;
let overlayPointerOverToolbar = false;
let cursorPollInFlight = false;
let lastGlobalCursorPos: { x: number; y: number } | null = null;

function usesGlobalCursor(tool: Tool): boolean {
  return tool.id === "laser" || tool.id === "spotlight" || tool.id === "magnifier";
}

function syncActiveToolPresentation(tool: Tool): void {
  document.body.dataset.tool = tool.id;
  canvas.style.cursor = tool.cursor;
}

function setActive(id: ToolId): void {
  if (active.id === id) {
    syncActiveToolPresentation(active);
    return;
  }
  active.onDeactivate?.(ctx);
  active = tools[id] ?? tools.pen;
  lastGlobalCursorPos = null;
  active.onActivate?.(ctx);
  if (active.id === "spotlight" || active.id === "magnifier") {
    active.onPointerMove(
      {
        pos: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        shift: false,
        alt: false,
        meta: false,
        pressure: 0.5,
        t: performance.now(),
      },
      ctx,
    );
  }
  syncActiveToolPresentation(active);
}

syncActiveToolPresentation(active);

function currentSnapshot(): DrawingSnapshot {
  return { version: 1, shapes: engine.getShapes(), bounds: engine.size() };
}

function buildExportCanvas(): HTMLCanvasElement | null {
  const { width, height } = engine.size();
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;
  const exportCtx = exportCanvas.getContext("2d", { alpha: true });
  if (!exportCtx) return null;
  engine.renderTo(exportCtx);
  BlurLayer.renderTo(exportCtx);
  return exportCanvas;
}

function exportPng(): void {
  const exportCanvas = buildExportCanvas();
  if (!exportCanvas) return;
  void window.inkover.exportImage(exportCanvas.toDataURL("image/png"));
}

function exportSvg(): void {
  const exportCanvas = buildExportCanvas();
  if (!exportCanvas) return;
  const { width, height } = engine.size();
  const pngDataUrl = exportCanvas.toDataURL("image/png");
  const svgMarkup = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
    `  <image href="${pngDataUrl}" width="${width}" height="${height}" preserveAspectRatio="none" />`,
    "</svg>",
  ].join("\n");
  void window.inkover.exportSvg(svgMarkup);
}

// ---- Settings + initial sync --------------------------------------------

void window.inkover.getSettings().then((s) => {
  style = s.defaultStyle;
});
window.inkover.onStyleChange((s) => {
  style = s;
});
window.inkover.onToolChange((id) => setActive(id));
window.inkover.onToolbarBoundsChange((bounds) => {
  toolbarBounds = bounds;
  engine.setExcludedRect(bounds);
});
window.inkover.onHistoryAction(({ action }) => {
  if (action === "undo") {
    const prev = history.undo(engine.getShapes());
    if (prev) {
      engine.setShapes(prev);
      BlurLayer.syncTo(prev);
    }
  } else if (action === "redo") {
    const next = history.redo(engine.getShapes());
    if (next) {
      engine.setShapes(next);
      BlurLayer.syncTo(next);
    }
  } else if (action === "clear") {
    engine.clear();
    history.push([]);
    BlurLayer.syncTo([]);
  }
});
window.inkover.onVisibilityChange(({ visible }) => {
  document.body.dataset.visible = String(visible);
});
window.inkover.onExportRequest(({ format }) => {
  if (format === "svg") {
    exportSvg();
    return;
  }
  exportPng();
});

// ---- Pointer plumbing ---------------------------------------------------

function pointerEvent(e: PointerEvent) {
  return {
    pos: { x: e.clientX, y: e.clientY },
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey || e.ctrlKey,
    pressure: e.pressure || 0.5,
    t: performance.now(),
  };
}

function isBlockedByToolbar(e: Pick<MouseEvent, "clientX" | "clientY">): boolean {
  if (!toolbarBounds) return false;
  return (
    e.clientX >= toolbarBounds.x &&
    e.clientX <= toolbarBounds.x + toolbarBounds.width &&
    e.clientY >= toolbarBounds.y &&
    e.clientY <= toolbarBounds.y + toolbarBounds.height
  );
}

function syncOverlayPointerOverToolbar(overToolbar: boolean): void {
  if (overlayPointerOverToolbar === overToolbar) return;
  overlayPointerOverToolbar = overToolbar;
  void window.inkover.setOverlayPointerOverToolbar(overToolbar);
}

function syncAnimatedToolToGlobalCursor(now = performance.now()): void {
  if (!usesGlobalCursor(active) || activePointerId !== null || cursorPollInFlight) return;
  cursorPollInFlight = true;
  void window.inkover.getCursorScreenPoint()
    .then((point) => {
      if (!usesGlobalCursor(active)) return;
      const localX = point.x - window.screenX;
      const localY = point.y - window.screenY;
      if (localX < 0 || localY < 0 || localX > window.innerWidth || localY > window.innerHeight) return;
      if (lastGlobalCursorPos && lastGlobalCursorPos.x === localX && lastGlobalCursorPos.y === localY) return;
      lastGlobalCursorPos = { x: localX, y: localY };
      active.onPointerMove(
        {
          pos: { x: localX, y: localY },
          shift: false,
          alt: false,
          meta: false,
          pressure: 0.5,
          t: now,
        },
        ctx,
      );
    })
    .catch(() => undefined)
    .finally(() => {
      cursorPollInFlight = false;
    });
}

function finishActivePointer(
  e: globalThis.PointerEvent,
  opts?: { canceled?: boolean; releaseCapture?: boolean },
): void {
  if (activePointerId !== e.pointerId) return;
  const blockedByToolbar = isBlockedByToolbar(e);
  syncOverlayPointerOverToolbar(blockedByToolbar);

  const canceled = opts?.canceled === true;
  const finalPointerEvent = canceled || blockedByToolbar ? lastAcceptedPointerEvent : pointerEvent(e);
  if (finalPointerEvent) active.onPointerUp(finalPointerEvent, ctx);

  activePointerId = null;
  lastAcceptedPointerEvent = null;
  if (opts?.releaseCapture !== false && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
}

window.addEventListener("mousemove", (e) => {
  syncOverlayPointerOverToolbar(isBlockedByToolbar(e));
});

window.addEventListener("blur", () => {
  syncOverlayPointerOverToolbar(false);
});

canvas.addEventListener("pointerdown", (e) => {
  const blockedByToolbar = isBlockedByToolbar(e);
  syncOverlayPointerOverToolbar(blockedByToolbar);
  if (blockedByToolbar) return;
  e.preventDefault();
  activePointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  const nextPointerEvent = pointerEvent(e);
  lastAcceptedPointerEvent = nextPointerEvent;
  active.onPointerDown(nextPointerEvent, ctx);
});
canvas.addEventListener("pointermove", (e) => {
  const blockedByToolbar = isBlockedByToolbar(e);
  syncOverlayPointerOverToolbar(blockedByToolbar);
  const canHoverTrack = active.animates;
  if (blockedByToolbar || (!canHoverTrack && activePointerId !== e.pointerId)) return;
  if (activePointerId === e.pointerId) e.preventDefault();
  const nextPointerEvent = pointerEvent(e);
  lastAcceptedPointerEvent = nextPointerEvent;
  active.onPointerMove(nextPointerEvent, ctx);
});
canvas.addEventListener("pointerup", (e) => {
  e.preventDefault();
  finishActivePointer(e);
});
canvas.addEventListener("pointercancel", (e) => {
  e.preventDefault();
  finishActivePointer(e, { canceled: true });
});
canvas.addEventListener("lostpointercapture", (e) => {
  finishActivePointer(e, { canceled: true, releaseCapture: false });
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// Animated tools (laser, spotlight, magnifier) want a frame loop even without
// pointer events. We tick once per rAF and let the tool decide what to do.
let lastTick = performance.now();
function tick(now: number) {
  const dt = now - lastTick;
  lastTick = now;
  syncAnimatedToolToGlobalCursor(now);
  if (active.animates) active.onFrame?.(ctx, dt);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Keyboard shortcuts — these only fire while the overlay is focused, which
// happens whenever the user is drawing. The toolbar window has its own.
window.addEventListener("keydown", (e) => {
  // If the user is editing text (a textarea or input has focus), don't
  // handle global shortcuts so typing isn't intercepted.
  const ae = document.activeElement as HTMLElement | null;
  if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT" || ae.isContentEditable)) return;
  if (active.onKey?.(e.key, ctx)) return;
  const k = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) {
    if (k === "z" && !e.shiftKey) { window.inkover.undo(); e.preventDefault(); return; }
    if ((k === "y") || (k === "z" && e.shiftKey)) { window.inkover.redo(); e.preventDefault(); return; }
    if (k === "s") {
      // Save the current drawing.
      void window.inkover.saveDrawing(currentSnapshot());
      e.preventDefault();
      return;
    }
    if (k === "e") {
      e.preventDefault();
      if (e.shiftKey) exportSvg();
      else exportPng();
      return;
    }
  }
  // Single-letter tool hotkeys.
  const map: Record<string, ToolId> = {
    p: "pen", h: "highlighter", l: "line", a: "arrow", r: "rect", o: "ellipse",
    t: "text", x: "eraser", j: "laser", s: "spotlight", m: "magnifier", b: "blur",
    v: "select",
  };
  if (map[k]) { window.inkover.setTool(map[k]); e.preventDefault(); }
  if (e.key === "Escape") { window.inkover.toggleVisible(); e.preventDefault(); }
});

// Make sure recognized blur shapes have their DOM nodes when restored from disk.
BlurLayer.syncTo(engine.getShapes());
