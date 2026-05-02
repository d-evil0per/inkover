// Overlay renderer — the script attached to overlay.html. It owns the canvas
// engine, the active tool, and the IPC subscriptions that keep tool/style/
// history/visibility in sync with the toolbar and the rest of the app.

import { CanvasEngine } from "./canvas-engine";
import { History } from "./history";
import type { Tool, ToolContext } from "./tools/base";
import { newId } from "./tools/base";
import { PenTool } from "./tools/pen";
import { HighlighterTool } from "./tools/highlighter";
import { LineTool, ArrowTool, RectTool, EllipseTool } from "./tools/shape-tools";
import { TextTool } from "./tools/text";
import { EraserTool } from "./tools/eraser";
import { LaserTool } from "./tools/laser";
import { SpotlightTool } from "./tools/spotlight";
import { MagnifierTool } from "./tools/magnifier";
import { BlurTool, BlurLayer } from "./tools/blur";
import { DEFAULT_SETTINGS, type StrokeStyle, type ToolId } from "@shared/types";

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
let smartShapes = DEFAULT_SETTINGS.smartShapesEnabled;
const ctx: ToolContext = {
  engine,
  history,
  style: () => style,
  smartShapes: () => smartShapes,
  newId,
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

let active: Tool = tools.pen;
active.onActivate?.(ctx);

function setActive(id: ToolId): void {
  if (active.id === id) return;
  active.onDeactivate?.(ctx);
  active = tools[id] ?? tools.pen;
  active.onActivate?.(ctx);
  document.body.dataset.tool = id;
  canvas.style.cursor = active.cursor;
}

// ---- Settings + initial sync --------------------------------------------

void window.inkover.getSettings().then((s) => {
  style = s.defaultStyle;
  smartShapes = s.smartShapesEnabled;
});
window.inkover.onSettingsChange((s) => {
  smartShapes = s.smartShapesEnabled;
});
window.inkover.onStyleChange((s) => {
  style = s;
});
window.inkover.onToolChange((id) => setActive(id));
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
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  active.onPointerDown(pointerEvent(e), ctx);
});
canvas.addEventListener("pointermove", (e) => active.onPointerMove(pointerEvent(e), ctx));
canvas.addEventListener("pointerup", (e) => {
  active.onPointerUp(pointerEvent(e), ctx);
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// Animated tools (laser, spotlight, magnifier) want a frame loop even without
// pointer events. We tick once per rAF and let the tool decide what to do.
let lastTick = performance.now();
function tick(now: number) {
  const dt = now - lastTick;
  lastTick = now;
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
      const snap = { version: 1 as const, shapes: engine.getShapes(), bounds: engine.size() };
      void window.inkover.saveDrawing(snap);
      e.preventDefault();
      return;
    }
    if (k === "e") {
      // Export PNG — render the canvas to a data URL.
      e.preventDefault();
      void window.inkover.exportImage(canvas.toDataURL("image/png"));
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
