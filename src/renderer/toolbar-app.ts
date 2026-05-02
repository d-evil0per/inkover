// Toolbar renderer — the floating, draggable, collapsible dock.
//
// Visual goal: a single tight column of icon buttons. Anything compound (color
// palette, stroke width, recording options) hides behind a single button that
// reveals a horizontal flyout on demand. This keeps the dock looking like a
// modern macOS Dock instead of a kitchen-sink toolbox.

import type { Settings, ToolId, StrokeStyle, RecorderStatus } from "@shared/types";
import { startCapture, stopCapture } from "./recorder-page";

const ROOT = document.getElementById("root") as HTMLDivElement;

// ---- Capture-mode bootstrap (hidden recorder window) ---------------------
const url = new URL(location.href);
if (url.searchParams.get("capture") === "1") {
  const sourceId = url.searchParams.get("sourceId") ?? "";
  void startCapture(sourceId).catch((err) => console.error("[capture] start", err));
  window.inkover.onRecordStopRequest(() => void stopCapture());
  window.inkover.onRecordPauseRequest(() => {
    import("./recorder-page").then((m) => m.pauseCapture());
  });
  window.inkover.onRecordResumeRequest(() => {
    import("./recorder-page").then((m) => m.resumeCapture());
  });
} else {
  void initToolbar();
}

// ---- Icons ---------------------------------------------------------------
const I = {
  logo: `<path d="M12 3c-3.5 5-5.5 8.4-5.5 11a5.5 5.5 0 0 0 11 0c0-2.6-2-6-5.5-11Z" fill="currentColor" stroke="none"/>`,
  select: `<path d="M3 3l7.07 17 2.51-7.51L20 10z"/>`,
  pen: `<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497Z"/><path d="m15 5 4 4"/>`,
  highlighter: `<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.83 0l-5.17-5.17a2 2 0 0 1 0-2.83L14 4"/>`,
  line: `<path d="M5 19 19 5"/>`,
  arrow: `<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>`,
  rect: `<rect x="4" y="4" width="16" height="16" rx="1.5"/>`,
  ellipse: `<circle cx="12" cy="12" r="8"/>`,
  shapes: `<rect x="3" y="3" width="9" height="9" rx="1"/><circle cx="17" cy="17" r="4"/>`,
  text: `<path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/><path d="M12 4v16"/>`,
  laser: `<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4"/>`,
  spotlight: `<circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>`,
  magnifier: `<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.5-3.5"/>`,
  presentation: `<path d="M3 4h18v12H3z"/><path d="M8 20h8"/><path d="M12 16v4"/>`,
  blur: `<circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="12" cy="6" r="1" fill="currentColor"/><circle cx="18" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/><circle cx="12" cy="18" r="1" fill="currentColor"/><circle cx="18" cy="18" r="1" fill="currentColor"/>`,
  eraser: `<path d="m7 21-4-4 11-11 4 4-7 11"/><path d="M22 21H7"/><path d="m5 13 4 4"/>`,
  undo: `<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 2.7L3 13"/>`,
  redo: `<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.7 2.7L21 13"/>`,
  trash: `<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  record: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/>`,
  chevronLeft: `<path d="m15 18-6-6 6-6"/>`,
  chevronRight: `<path d="m9 18 6-6-6-6"/>`,
  hide: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
};

function icon(path: string, size = 18): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

// ---- Tool catalogue -----------------------------------------------------
interface ToolMeta {
  id: ToolId;
  label: string;
  hint: string;
  shortcut: string;
  iconKey: keyof typeof I;
}

interface ToolGroup {
  groupId: "shapes" | "presentation";
  label: string;
  hint: string;
  iconKey: keyof typeof I;
  variants: ToolMeta[];
  defaultVariant: ToolId;
}

const TOOLS_PEN: ToolMeta = { id: "pen",         label: "Pen",         hint: "Freehand drawing",         shortcut: "P", iconKey: "pen" };
const TOOLS_HL:  ToolMeta = { id: "highlighter", label: "Highlighter", hint: "Translucent marker",       shortcut: "H", iconKey: "highlighter" };
const TOOLS_TXT: ToolMeta = { id: "text",        label: "Text",        hint: "Drop a label",             shortcut: "T", iconKey: "text" };
const TOOLS_BLR: ToolMeta = { id: "blur",        label: "Blur",        hint: "Mosaic / redact a region", shortcut: "B", iconKey: "blur" };
const TOOLS_ERS: ToolMeta = { id: "eraser",      label: "Eraser",      hint: "Drag to remove shapes",    shortcut: "X", iconKey: "eraser" };
const TOOLS_SEL: ToolMeta = { id: "select",      label: "Pass-through",hint: "Click through to desktop", shortcut: "V", iconKey: "select" };

const SHAPES_GROUP: ToolGroup = {
  groupId: "shapes",
  label: "Shapes",
  hint: "Geometric primitives",
  iconKey: "shapes",
  defaultVariant: "rect",
  variants: [
    { id: "rect",    label: "Rectangle", hint: "Shift = square",   shortcut: "R", iconKey: "rect" },
    { id: "ellipse", label: "Ellipse",   hint: "Shift = circle",   shortcut: "O", iconKey: "ellipse" },
    { id: "line",    label: "Line",      hint: "Shift = 45° snap", shortcut: "L", iconKey: "line" },
    { id: "arrow",   label: "Arrow",     hint: "Shift = 45° snap", shortcut: "A", iconKey: "arrow" },
  ],
};

const PRESENT_GROUP: ToolGroup = {
  groupId: "presentation",
  label: "Presentation",
  hint: "Laser, spotlight, magnifier",
  iconKey: "presentation",
  defaultVariant: "laser",
  variants: [
    { id: "laser",     label: "Laser",     hint: "Glowing pointer trail",       shortcut: "J", iconKey: "laser" },
    { id: "spotlight", label: "Spotlight", hint: "Dim everything but a circle", shortcut: "S", iconKey: "spotlight" },
    { id: "magnifier", label: "Magnifier", hint: "Loupe over the cursor",       shortcut: "M", iconKey: "magnifier" },
  ],
};

type Slot =
  | { kind: "tool"; tool: ToolMeta }
  | { kind: "group"; group: ToolGroup };

const PRIMARY_SLOTS: Slot[] = [
  { kind: "tool", tool: TOOLS_PEN },
  { kind: "tool", tool: TOOLS_HL },
  { kind: "group", group: SHAPES_GROUP },
  { kind: "tool", tool: TOOLS_TXT },
  { kind: "group", group: PRESENT_GROUP },
  { kind: "tool", tool: TOOLS_BLR },
  { kind: "tool", tool: TOOLS_ERS },
];

// ---- App initialization -------------------------------------------------

async function initToolbar() {
  const settings: Settings = await window.inkover.getSettings();
  const state = {
    activeTool: "pen" as ToolId,
    style: { ...settings.defaultStyle } as StrokeStyle,
    settings,
    recorder: { state: "idle" } as RecorderStatus,
    collapsed: false,
    activeShape: SHAPES_GROUP.defaultVariant,
    activePresent: PRESENT_GROUP.defaultVariant,
    openFlyout: null as null | "shapes" | "presentation" | "style" | "record",
    recordFormat: "webm" as "webm" | "gif",
  };

  document.body.innerHTML = "";
  document.body.appendChild(ROOT);
  ROOT.className = "tb-root";
  render();

  // Estimate required toolbar width to fit an N-button horizontal flyout.
  function computeRequiredWidthForVariants(n: number): number {
    const btnSize = 36;
    const gap = 8;
    const padding = 24; // flyout padding + margins
    const arrow = 12;
    const width = padding + arrow + n * btnSize + Math.max(0, (n - 1) * gap);
    return Math.min(Math.max(220, Math.ceil(width)), 480);
  }

  document.addEventListener("click", (e) => {
    if (!state.openFlyout) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-flyout]") || target.closest("[data-group]")) return;
    state.openFlyout = null;
    render();
  });

  function render() {
    ROOT.innerHTML = state.collapsed ? renderCollapsed() : renderExpanded();
    bindHandlers();
    document.body.dataset.collapsed = String(state.collapsed);
  }

  // ---- Templates ------------------------------------------------------

  function renderCollapsed(): string {
    // A single circular icon button. No outer pill / inner button stack —
    // that's what made the previous version look like a D-shape (two
    // overlapping rounded rectangles with their own backgrounds).
    //
    // Click anywhere on the circle to expand. We don't expose a drag region
    // when collapsed; users can expand, reposition, then collapse again.
    return `
      <button class="tb-collapsed" id="expand"
        aria-label="Expand toolbar"
        data-tooltip="Expand toolbar"
        data-tooltip-side="right">
        ${icon(I.logo, 22)}
      </button>
    `;
  }

  function renderExpanded(): string {
    return `
      <div class="tb-pill tb-pill--expanded">
        <header class="tb-header" id="grip" data-tooltip="Drag to move" data-tooltip-side="right">
          <span class="tb-logo">${icon(I.logo, 18)}</span>
        </header>

        <div class="tb-divider"></div>

        <section class="tb-section" aria-label="Tools">
          ${PRIMARY_SLOTS.map(renderSlot).join("")}
        </section>

        <div class="tb-divider"></div>

        <section class="tb-section">
          ${renderStyleButton()}
        </section>

        <div class="tb-divider"></div>

        <section class="tb-section">
          ${btn({ id: "undo",  iconKey: "undo",  label: "Undo",  shortcut: "⌘Z" })}
          ${btn({ id: "redo",  iconKey: "redo",  label: "Redo",  shortcut: "⌘⇧Z" })}
          ${btn({ id: "clear", iconKey: "trash", label: "Clear", shortcut: "" })}
        </section>

        <div class="tb-divider"></div>

        <section class="tb-section">
          ${renderRecordButton()}
        </section>

        <div class="tb-divider"></div>

        <section class="tb-section tb-section--bottom">
          ${btn({ id: TOOLS_SEL.id, iconKey: TOOLS_SEL.iconKey, label: TOOLS_SEL.label,
                  shortcut: TOOLS_SEL.shortcut, className: "tb-btn--tool",
                  extraAttrs: `data-tool="${TOOLS_SEL.id}"` })}
          ${btn({ id: "hide", iconKey: "hide", label: "Hide overlay", shortcut: "Esc" })}
          ${btn({ id: "collapse", iconKey: "chevronLeft", label: "Collapse toolbar", shortcut: "" })}
        </section>
      </div>
    `;
  }

  function renderSlot(slot: Slot): string {
    return slot.kind === "tool" ? renderToolButton(slot.tool) : renderGroupButton(slot.group);
  }

  function renderToolButton(t: ToolMeta): string {
    const active = t.id === state.activeTool;
    return `
      <button class="tb-btn tb-btn--tool ${active ? "is-active" : ""}"
        data-tool="${t.id}"
        data-tooltip="${escape(t.label)} · ${escape(t.hint)}"
        data-tooltip-shortcut="${t.shortcut}"
        data-tooltip-side="right"
        aria-label="${escape(t.label)} (${t.shortcut})">
        ${icon(I[t.iconKey])}
      </button>
    `;
  }

  function renderGroupButton(g: ToolGroup): string {
    const variantId = g.groupId === "shapes" ? state.activeShape : state.activePresent;
    const variant = g.variants.find((v) => v.id === variantId) ?? g.variants[0];
    const active = state.activeTool === variant.id;
    const open = state.openFlyout === g.groupId;
    return `
      <div class="tb-group-wrap" data-group="${g.groupId}">
        <button class="tb-btn tb-btn--tool tb-btn--group ${active ? "is-active" : ""} ${open ? "is-open" : ""}"
          data-group-action="use"
          data-tool="${variant.id}"
          data-tooltip="${escape(g.label)} · ${escape(variant.label)}"
          data-tooltip-shortcut="${variant.shortcut}"
          data-tooltip-side="right"
          aria-label="${escape(g.label)} (${variant.label})">
          ${icon(I[variant.iconKey])}
          <span class="tb-group-chevron" data-group-action="open" aria-label="Open ${escape(g.label)} options">
            ${icon(I.chevronRight, 8)}
          </span>
        </button>
        ${open ? renderToolFlyout(g, variantId) : ""}
      </div>
    `;
  }

  function renderToolFlyout(g: ToolGroup, currentVariant: ToolId): string {
    return `
      <div class="tb-flyout" data-flyout="${g.groupId}" role="menu">
        <div class="tb-flyout-arrow"></div>
        ${g.variants
          .map(
            (v) => `
          <button class="tb-flyout-btn ${v.id === currentVariant ? "is-active" : ""}"
            data-flyout-tool="${v.id}"
            data-flyout-group="${g.groupId}"
            data-tooltip="${escape(v.label)}"
            data-tooltip-shortcut="${v.shortcut}"
            data-tooltip-side="bottom"
            aria-label="${escape(v.label)}">
            ${icon(I[v.iconKey])}
          </button>`,
          )
          .join("")}
      </div>
    `;
  }

  // The Style button replaces what used to be a palette + custom-color +
  // width-slider section. It looks like a single circular swatch in the
  // current color, with a stroke-thickness ring inside. Click → flyout.
  function renderStyleButton(): string {
    const open = state.openFlyout === "style";
    const dotSize = Math.max(4, Math.min(14, state.style.width + 4));
    return `
      <div class="tb-group-wrap" data-group="style">
        <button class="tb-btn tb-btn--style ${open ? "is-open" : ""}"
          id="style-toggle"
          data-tooltip="Color & size"
          data-tooltip-side="right"
          aria-label="Color and size">
          <span class="tb-style-swatch" style="--swatch:${state.style.color};">
            <span class="tb-style-dot" style="width:${dotSize}px;height:${dotSize}px;background:${state.style.color}"></span>
          </span>
        </button>
        ${open ? renderStyleFlyout() : ""}
      </div>
    `;
  }

  function renderStyleFlyout(): string {
    const palette = ["#FF3B30", "#FF9500", "#FFCC00", "#30D158", "#0A84FF", "#BF5AF2", "#FFFFFF", "#1C1C1E"];
    const swatches = palette
      .map((c) => {
        const isActive = c.toUpperCase() === state.style.color.toUpperCase();
        return `<button class="tb-swatch ${isActive ? "is-active" : ""}"
          data-color="${c}" style="--swatch:${c}"
          aria-label="Color ${c}"></button>`;
      })
      .join("");
    return `
      <div class="tb-flyout tb-flyout--style" data-flyout="style" role="menu">
        <div class="tb-flyout-arrow"></div>
        <div class="tb-style-row">${swatches}</div>
        <div class="tb-style-row tb-style-row--bottom">
          <input type="color" id="custom-color" value="${state.style.color}" class="tb-color-input"
            aria-label="Custom color" />
          <input type="range" id="width" min="1" max="20" step="1" value="${state.style.width}"
            class="tb-range" aria-label="Stroke width" />
          <span class="tb-range-num" id="width-num">${state.style.width}</span>
        </div>
      </div>
    `;
  }

  function renderRecordButton(): string {
    const open = state.openFlyout === "record";
    const recording = state.recorder.state === "recording";
    return `
      <div class="tb-group-wrap" data-group="record">
        <button class="tb-btn tb-btn--rec ${recording ? "is-recording" : ""} ${open ? "is-open" : ""}"
          id="record-toggle"
          data-tooltip="${recording ? "Stop recording" : "Record screen"}"
          data-tooltip-shortcut="${recording ? "" : "⌘⇧R"}"
          data-tooltip-side="right"
          aria-label="${recording ? "Stop recording" : "Record screen"}">
          ${icon(I.record)}
        </button>
        ${!recording && open ? renderRecordFlyout() : ""}
      </div>
    `;
  }

  function renderRecordFlyout(): string {
    return `
      <div class="tb-flyout tb-flyout--record" data-flyout="record" role="menu">
        <div class="tb-flyout-arrow"></div>
        <div class="tb-rec-formats">
          <button class="tb-pill-btn ${state.recordFormat === "webm" ? "is-active" : ""}"
            data-rec-format="webm">WebM</button>
          <button class="tb-pill-btn ${state.recordFormat === "gif" ? "is-active" : ""}"
            data-rec-format="gif">GIF</button>
        </div>
        <button class="tb-rec-start" id="rec-start">
          <span class="tb-rec-dot"></span> Start recording
        </button>
      </div>
    `;
  }

  interface BtnSpec {
    id: string;
    iconKey: keyof typeof I;
    label: string;
    shortcut: string;
    className?: string;
    extraAttrs?: string;
  }
  function btn(spec: BtnSpec): string {
    return `
      <button class="tb-btn ${spec.className ?? ""}"
        id="${spec.id}"
        ${spec.extraAttrs ?? ""}
        data-tooltip="${escape(spec.label)}"
        data-tooltip-shortcut="${spec.shortcut}"
        data-tooltip-side="right"
        aria-label="${escape(spec.label)}">
        ${icon(I[spec.iconKey])}
      </button>
    `;
  }

  // ---- Handlers --------------------------------------------------------

  function bindHandlers() {
    if (state.collapsed) {
      document.getElementById("expand")?.addEventListener("click", () => toggleCollapse());
      return;
    }

    // Tools (and "use last variant" click on a group button).
    ROOT.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => {
      b.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-group-action="open"]')) return;
        const tool = b.dataset.tool as ToolId;
        applyTool(tool);
      });
    });

    // Group chevrons
    ROOT.querySelectorAll<HTMLElement>('[data-group-action="open"]').forEach((c) => {
      c.addEventListener("click", (e) => {
        e.stopPropagation();
        const wrap = c.closest("[data-group]") as HTMLElement | null;
        if (!wrap) return;
        const id = wrap.dataset.group as "shapes" | "presentation";
        const willOpen = state.openFlyout !== id;
        if (willOpen) {
          state.openFlyout = id;
          render();
          // Ask main to resize if needed, but don't block the UI if IPC fails.
          try {
            const variants = (id === "shapes" ? SHAPES_GROUP.variants.length : PRESENT_GROUP.variants.length);
            const desired = computeRequiredWidthForVariants(variants);
            void window.inkover.resizeToolbar(desired);
          } catch (err) {
            // ignore
          }
        } else {
          state.openFlyout = null;
          render();
        }
      });
    });

    // Flyout items
    ROOT.querySelectorAll<HTMLElement>("[data-flyout-tool]").forEach((b) => {
      b.addEventListener("click", () => {
        const tool = b.dataset.flyoutTool as ToolId;
        const group = b.dataset.flyoutGroup as "shapes" | "presentation";
        if (group === "shapes") state.activeShape = tool;
        else state.activePresent = tool;
        state.openFlyout = null;
        applyTool(tool);
        render();
      });
    });

    // Style toggle + flyout contents
    document.getElementById("style-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = state.openFlyout !== "style";
      if (willOpen) {
        state.openFlyout = "style";
        render();
        try { void window.inkover.resizeToolbar(260); } catch {}
      } else {
        state.openFlyout = null;
        render();
      }
    });
    ROOT.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((b) => {
      b.addEventListener("click", () => {
        const c = b.dataset.color!;
        state.style = { ...state.style, color: c };
        void window.inkover.setStyle({ color: c });
        render();
      });
    });
    const customColor = document.getElementById("custom-color") as HTMLInputElement | null;
    customColor?.addEventListener("input", () => {
      state.style = { ...state.style, color: customColor.value };
      void window.inkover.setStyle({ color: customColor.value });
      // No re-render here so the native picker stays open.
    });
    const width = document.getElementById("width") as HTMLInputElement | null;
    const widthNum = document.getElementById("width-num");
    width?.addEventListener("input", () => {
      const v = Number(width.value);
      state.style = { ...state.style, width: v };
      if (widthNum) widthNum.textContent = String(v);
      void window.inkover.setStyle({ width: v });
    });

    // History
    document.getElementById("undo")?.addEventListener("click", () => window.inkover.undo());
    document.getElementById("redo")?.addEventListener("click", () => window.inkover.redo());
    document.getElementById("clear")?.addEventListener("click", () => {
      if (confirm("Clear all annotations?")) window.inkover.clear();
    });

    // Hide / collapse
    document.getElementById("hide")?.addEventListener("click", () => window.inkover.toggleVisible());
    document.getElementById("collapse")?.addEventListener("click", () => toggleCollapse());

    // Record
    document.getElementById("record-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.recorder.state !== "idle") {
        void window.inkover.recordStop();
        return;
      }
      const willOpen = state.openFlyout !== "record";
      if (willOpen) {
        state.openFlyout = "record";
        render();
        try { void window.inkover.resizeToolbar(220); } catch {}
      } else {
        state.openFlyout = null;
        render();
      }
    });
    ROOT.querySelectorAll<HTMLButtonElement>("[data-rec-format]").forEach((b) => {
      b.addEventListener("click", () => {
        state.recordFormat = (b.dataset.recFormat as "webm" | "gif") ?? "webm";
        render();
      });
    });
    document.getElementById("rec-start")?.addEventListener("click", () => {
      state.openFlyout = null;
      render();
      void onStartRecording();
    });
  }

  function applyTool(tool: ToolId) {
    state.activeTool = tool;
    void window.inkover.setTool(tool);
    ROOT.querySelectorAll<HTMLButtonElement>(".tb-btn--tool").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.tool === tool);
    });
  }

  function toggleCollapse() {
    state.collapsed = !state.collapsed;
    state.openFlyout = null;
    render();
  }

  async function onStartRecording() {
    const sources = await window.inkover.getCaptureSources();
    if (sources.length === 0) {
      alert("No screen sources available — check screen recording permissions.");
      return;
    }
    const choice = await pickSource(sources);
    if (!choice) return;
    await window.inkover.recordStart(choice.id);
  }

  // ---- Subscriptions ---------------------------------------------------

  window.inkover.onRecorderStatus((s) => {
    state.recorder = s;
    render();
    if (s.error === "open-picker") {
      state.openFlyout = "record";
      render();
    }
  });

  window.inkover.onSettingsChange((s) => {
    state.settings = s;
  });

  window.inkover.onToolChange((tool) => {
    if (tool === state.activeTool) return;
    state.activeTool = tool;
    if (SHAPES_GROUP.variants.some((v) => v.id === tool)) state.activeShape = tool;
    if (PRESENT_GROUP.variants.some((v) => v.id === tool)) state.activePresent = tool;
    render();
  });
}

// ---- Source picker modal ------------------------------------------------

async function pickSource(
  sources: { id: string; name: string; thumbnail: string }[],
): Promise<{ id: string; name: string } | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "tb-modal";
    wrap.innerHTML = `
      <div class="tb-modal-card" role="dialog" aria-modal="true" aria-label="Pick a source">
        <h2>Pick a source to record</h2>
        <div class="tb-source-grid">
          ${sources
            .map(
              (s) => `
            <button class="tb-source" data-id="${s.id}">
              <img src="${s.thumbnail}" alt="">
              <div class="tb-source-name">${escape(s.name)}</div>
            </button>`,
            )
            .join("")}
        </div>
        <div class="tb-modal-actions">
          <button id="cancel" class="tb-modal-btn">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    wrap.querySelectorAll<HTMLButtonElement>(".tb-source").forEach((b) => {
      b.addEventListener("click", () => {
        wrap.remove();
        const s = sources.find((x) => x.id === b.dataset.id);
        resolve(s ? { id: s.id, name: s.name } : null);
      });
    });
    wrap.querySelector("#cancel")!.addEventListener("click", () => {
      wrap.remove();
      resolve(null);
    });
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) {
        wrap.remove();
        resolve(null);
      }
    });
  });
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
