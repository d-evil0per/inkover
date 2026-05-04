// Toolbar renderer — the floating, draggable, collapsible dock.
//
// Visual goal: a single tight column of icon buttons. Anything compound (color
// palette, stroke width, recording options) hides behind a single button that
// reveals a horizontal flyout on demand. This keeps the dock looking like a
// modern macOS Dock instead of a kitchen-sink toolbox.

import type { ExportFormat, Settings, ToolId, StrokeStyle, RecorderStatus } from "@shared/types";
import { pauseCapture, resumeCapture, startCapture, stopCapture } from "./recorder-page";

const ROOT = document.getElementById("root") as HTMLDivElement;

void initToolbar();

function getInkoverApi(): Window["inkover"] | undefined {
  return (window as Window & { inkover?: Window["inkover"] }).inkover;
}

function renderStartupError(message: string, detail?: string): void {
  const box = document.createElement("div");
  box.className = "tb-startup-error";

  const title = document.createElement("strong");
  title.textContent = "InkOver bridge unavailable";
  box.appendChild(title);

  const body = document.createElement("p");
  body.textContent = message;
  box.appendChild(body);

  if (detail) {
    const info = document.createElement("code");
    info.textContent = detail;
    box.appendChild(info);
  }

  document.body.innerHTML = "";
  document.body.appendChild(ROOT);
  ROOT.className = "tb-root tb-root--startup-error";
  ROOT.replaceChildren(box);
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
  eyeOpen: `<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>`,
  eyeClosed: `<path d="M3 3 21 21"/><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17.2 17.2 0 0 1-3.2 3.9"/><path d="M6.2 6.3A16.5 16.5 0 0 0 2.5 12s3.5 7 9.5 7a9.9 9.9 0 0 0 3.1-.5"/>`,
  export: `<path d="M12 3v11"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>`,
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
  groupId: "ink" | "shapes" | "presentation";
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

const INK_GROUP: ToolGroup = {
  groupId: "ink",
  label: "Ink",
  hint: "Pen, highlighter, eraser",
  iconKey: "pen",
  defaultVariant: "pen",
  variants: [TOOLS_PEN, TOOLS_HL, TOOLS_ERS],
};

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
  hint: "Laser, spotlight, magnifier, blur",
  iconKey: "presentation",
  defaultVariant: "laser",
  variants: [
    { id: "laser",     label: "Laser",     hint: "Glowing pointer trail",       shortcut: "J", iconKey: "laser" },
    { id: "spotlight", label: "Spotlight", hint: "Dim everything but a circle", shortcut: "S", iconKey: "spotlight" },
    { id: "magnifier", label: "Magnifier", hint: "Loupe over the cursor",       shortcut: "M", iconKey: "magnifier" },
    TOOLS_BLR,
  ],
};

type Slot =
  | { kind: "tool"; tool: ToolMeta }
  | { kind: "group"; group: ToolGroup };

const PRIMARY_SLOTS: Slot[] = [
  { kind: "tool", tool: TOOLS_SEL },
  { kind: "group", group: INK_GROUP },
  { kind: "group", group: SHAPES_GROUP },
  { kind: "tool", tool: TOOLS_TXT },
  { kind: "group", group: PRESENT_GROUP },
];

const TOOL_SHORTCUTS: Partial<Record<string, ToolId>> = {
  p: "pen",
  h: "highlighter",
  l: "line",
  a: "arrow",
  r: "rect",
  o: "ellipse",
  t: "text",
  x: "eraser",
  j: "laser",
  s: "spotlight",
  m: "magnifier",
  b: "blur",
  v: "select",
};

// ---- App initialization -------------------------------------------------

async function initToolbar() {
  const inkover = getInkoverApi();
  if (!inkover) {
    const browserHint = location.protocol.startsWith("http")
      ? "This page is running in the Vite browser context, not inside the Electron toolbar window."
      : "The Electron preload script did not attach before the toolbar renderer started.";
    const message = `${browserHint} Open the toolbar through Electron to access the window.inkover API.`;
    console.error("[toolbar] missing window.inkover bridge", { href: location.href });
    renderStartupError(message, location.href);
    return;
  }

  const settings: Settings = await inkover.getSettings();
  const state = {
    activeTool: "select" as ToolId,
    style: { ...settings.defaultStyle } as StrokeStyle,
    settings,
    recorder: { state: "idle" } as RecorderStatus,
    collapsed: false,
    overlayVisible: true,
    activeInk: INK_GROUP.defaultVariant,
    activeShape: SHAPES_GROUP.defaultVariant,
    activePresent: PRESENT_GROUP.defaultVariant,
    openFlyout: null as null | "ink" | "shapes" | "presentation" | "style" | "export" | "record",
    recordFormat: "webm" as "webm" | "gif",
  };

  document.body.innerHTML = "";
  document.body.appendChild(ROOT);
  ROOT.className = "tb-root";
  let visibleBoundsFrame = 0;
  let captureAttemptId = 0;

  render();

  // Schedule an extra visible-bounds sync after the flyout has fully laid
  // out (and any open animation has settled) to make sure the native window
  // grows wide enough to contain the flyout. Two rAFs guarantees the
  // browser has performed layout for the just-rendered DOM.
  function syncBoundsAfterFlyoutLayout(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        syncVisibleBounds();
      });
    });
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
    queueVisibleBoundsSync();
  }

  function queueVisibleBoundsSync(): void {
    if (visibleBoundsFrame) cancelAnimationFrame(visibleBoundsFrame);
    visibleBoundsFrame = requestAnimationFrame(() => {
      visibleBoundsFrame = 0;
      syncVisibleBounds();
    });
  }

  function syncVisibleBounds(): void {
    const anchors = Array.from(
      ROOT.querySelectorAll<HTMLElement>(".tb-pill, .tb-collapsed, [data-flyout]"),
    ).filter((el) => el.offsetParent !== null);
    if (anchors.length === 0) {
      void window.inkover.setToolbarVisibleBounds(null);
      return;
    }

    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    for (const el of anchors) {
      const rect = el.getBoundingClientRect();
      const measuredWidth = el.dataset.flyout ? Math.max(rect.width, el.scrollWidth) : rect.width;
      const measuredHeight = el.dataset.flyout ? Math.max(rect.height, el.scrollHeight) : rect.height;
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.left + measuredWidth);
      bottom = Math.max(bottom, rect.top + measuredHeight);
    }

    void window.inkover.setToolbarVisibleBounds({
      x: Math.max(0, Math.round(left)),
      y: Math.max(0, Math.round(top)),
      width: Math.max(0, Math.round(right - left)),
      height: Math.max(0, Math.round(bottom - top)),
    });
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
          ${renderExportButton()}
        </section>

        <div class="tb-divider"></div>

        <section class="tb-section">
          ${renderRecordButton()}
        </section>

        <div class="tb-divider"></div>

        <section class="tb-section tb-section--bottom">
          ${btn({
            id: "visibility",
            iconKey: state.overlayVisible ? "eyeOpen" : "eyeClosed",
            label: state.overlayVisible ? "Hide overlay" : "Show overlay",
            shortcut: "Esc",
          })}
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
    const variantId = getActiveGroupVariant(g.groupId);
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
    const busy = state.recorder.state !== "idle";
    return `
      <div class="tb-group-wrap" data-group="record">
        <button class="tb-btn tb-btn--rec ${recording ? "is-recording" : ""} ${open ? "is-open" : ""}"
          id="record-toggle"
          data-tooltip="${busy ? "Recording controls" : "Record screen"}"
          data-tooltip-shortcut="${busy ? "" : "⌘⇧R"}"
          data-tooltip-side="right"
          aria-label="${busy ? "Recording controls" : "Record screen"}">
          ${icon(I.record)}
        </button>
        ${open ? renderRecordFlyout() : ""}
      </div>
    `;
  }

  function renderExportButton(): string {
    const open = state.openFlyout === "export";
    return `
      <div class="tb-group-wrap" data-group="export">
        <button class="tb-btn ${open ? "is-open" : ""}"
          id="export-toggle"
          data-tooltip="Export drawing"
          data-tooltip-shortcut="⌘E / ⌘⇧E"
          data-tooltip-side="right"
          aria-label="Export drawing">
          ${icon(I.export)}
        </button>
        ${open ? renderExportFlyout() : ""}
      </div>
    `;
  }

  function renderExportFlyout(): string {
    return `
      <div class="tb-flyout tb-flyout--export" data-flyout="export" role="menu">
        <div class="tb-flyout-arrow"></div>
        <button class="tb-export-action" data-export-format="png">Export PNG</button>
        <button class="tb-export-action" data-export-format="svg">Export SVG</button>
      </div>
    `;
  }

  function renderRecordFlyout(): string {
    const starting = state.recorder.state === "starting";
    const recording = state.recorder.state === "recording" || state.recorder.state === "paused";
    const encoding = state.recorder.state === "encoding";
    const idle = state.recorder.state === "idle";
    return `
      <div class="tb-flyout tb-flyout--record" data-flyout="record" role="menu">
        <div class="tb-flyout-arrow"></div>
        ${idle ? `
        <div class="tb-rec-formats">
          <button class="tb-pill-btn ${state.recordFormat === "webm" ? "is-active" : ""}"
            data-rec-format="webm">WebM</button>
          <button class="tb-pill-btn ${state.recordFormat === "gif" ? "is-active" : ""}"
            data-rec-format="gif">GIF</button>
        </div>` : ""}
        <button class="tb-rec-start ${(recording || starting) ? "tb-rec-start--stop" : ""}" id="${recording ? "rec-stop" : "rec-start"}" ${(encoding || starting) ? "disabled" : ""}>
          <span class="tb-rec-dot"></span> ${encoding ? "Encoding..." : starting ? "Starting..." : recording ? "Stop recording" : "Start recording"}
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

    const toggleGroupFlyout = (id: ToolGroup["groupId"]) => {
      const willOpen = state.openFlyout !== id;
      if (willOpen) {
        state.openFlyout = id;
        render();
        syncBoundsAfterFlyoutLayout();
      } else {
        state.openFlyout = null;
        render();
      }
    };

    // Standalone tools only. Grouped tool buttons manage flyout open/close below.
    ROOT.querySelectorAll<HTMLElement>("[data-tool]:not(.tb-btn--group)").forEach((b) => {
      b.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-group-action="open"]')) return;
        const tool = b.dataset.tool as ToolId;
        applyTool(tool);
      });
    });

    // Group buttons open their submenu when clicked.
    ROOT.querySelectorAll<HTMLButtonElement>(".tb-btn--group").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wrap = button.closest("[data-group]") as HTMLElement | null;
        if (!wrap) return;
        const id = wrap.dataset.group as ToolGroup["groupId"];
        toggleGroupFlyout(id);
      });
    });

    // Flyout items
    ROOT.querySelectorAll<HTMLElement>("[data-flyout-tool]").forEach((b) => {
      b.addEventListener("click", () => {
        const tool = b.dataset.flyoutTool as ToolId;
        const group = b.dataset.flyoutGroup as ToolGroup["groupId"];
        setActiveGroupVariant(group, tool);
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
        syncBoundsAfterFlyoutLayout();
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

    document.getElementById("export-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = state.openFlyout !== "export";
      if (willOpen) {
        state.openFlyout = "export";
        render();
        syncBoundsAfterFlyoutLayout();
      } else {
        state.openFlyout = null;
        render();
      }
    });
    ROOT.querySelectorAll<HTMLButtonElement>("[data-export-format]").forEach((button) => {
      button.addEventListener("click", () => {
        const format = (button.dataset.exportFormat as ExportFormat) ?? "png";
        state.openFlyout = null;
        render();
        void window.inkover.exportDrawing(format);
      });
    });

    // Hide / collapse
    document.getElementById("visibility")?.addEventListener("click", () => window.inkover.toggleVisible());
    document.getElementById("collapse")?.addEventListener("click", () => toggleCollapse());

    // Record
    document.getElementById("record-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = state.openFlyout !== "record";
      if (willOpen) {
        state.openFlyout = "record";
        render();
        syncBoundsAfterFlyoutLayout();
      } else {
        state.openFlyout = null;
        render();
      }
    });
    ROOT.querySelectorAll<HTMLButtonElement>("[data-rec-format]").forEach((b) => {
      b.addEventListener("click", () => {
        if (state.recorder.state !== "idle") return;
        state.recordFormat = (b.dataset.recFormat as "webm" | "gif") ?? "webm";
        render();
      });
    });
    document.getElementById("rec-start")?.addEventListener("click", () => {
      void onStartRecording();
    });
    document.getElementById("rec-stop")?.addEventListener("click", () => {
      void window.inkover.recordStop();
    });
  }

  function applyTool(tool: ToolId) {
    state.activeTool = tool;
    if (INK_GROUP.variants.some((variant) => variant.id === tool)) state.activeInk = tool;
    if (SHAPES_GROUP.variants.some((variant) => variant.id === tool)) state.activeShape = tool;
    if (PRESENT_GROUP.variants.some((variant) => variant.id === tool)) state.activePresent = tool;
    void window.inkover.setTool(tool);
    ROOT.querySelectorAll<HTMLButtonElement>(".tb-btn--tool").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.tool === tool);
    });
  }

  function getActiveGroupVariant(groupId: ToolGroup["groupId"]): ToolId {
    switch (groupId) {
      case "ink":
        return state.activeInk;
      case "shapes":
        return state.activeShape;
      case "presentation":
        return state.activePresent;
    }
  }

  function setActiveGroupVariant(groupId: ToolGroup["groupId"], tool: ToolId): void {
    switch (groupId) {
      case "ink":
        state.activeInk = tool;
        return;
      case "shapes":
        state.activeShape = tool;
        return;
      case "presentation":
        state.activePresent = tool;
        return;
    }
  }

  function toggleCollapse() {
    state.collapsed = !state.collapsed;
    state.openFlyout = null;
    render();
  }

  function applyToolShortcut(tool: ToolId): void {
    state.openFlyout = null;
    applyTool(tool);
    render();
  }

  function isEditingInput(): boolean {
    const activeElement = document.activeElement;
    return (
      activeElement instanceof HTMLElement &&
      (activeElement.tagName === "TEXTAREA" ||
        activeElement.tagName === "INPUT" ||
        activeElement.tagName === "SELECT" ||
        activeElement.isContentEditable)
    );
  }

  function openRecordControls(): void {
    state.openFlyout = "record";
    render();
    syncBoundsAfterFlyoutLayout();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (isEditingInput()) return;

    const key = e.key.toLowerCase();
    const hasPrimaryModifier = e.metaKey || e.ctrlKey;

    if (hasPrimaryModifier) {
      if (key === "z" && !e.shiftKey) {
        void window.inkover.undo();
        e.preventDefault();
        return;
      }

      if (key === "y" || (key === "z" && e.shiftKey)) {
        void window.inkover.redo();
        e.preventDefault();
        return;
      }

      if (e.shiftKey && key === "p") {
        void window.inkover.toggleVisible();
        e.preventDefault();
        return;
      }

      if (e.shiftKey && key === "r") {
        if (state.recorder.state === "idle") {
          openRecordControls();
        } else {
          void window.inkover.recordStop();
        }
        e.preventDefault();
        return;
      }

      if (key === "e") {
        void window.inkover.exportDrawing(e.shiftKey ? "svg" : "png");
        e.preventDefault();
        return;
      }

      return;
    }

    if (e.altKey) return;

    if (key === "escape") {
      void window.inkover.toggleVisible();
      e.preventDefault();
      return;
    }

    const tool = TOOL_SHORTCUTS[key];
    if (!tool) return;

    applyToolShortcut(tool);
    e.preventDefault();
  }

  async function onStartRecording() {
    if (state.recorder.state !== "idle") return;

    const attemptId = ++captureAttemptId;
    state.recorder = {
      ...state.recorder,
      state: "starting",
      error: undefined,
    };
    render();
    syncBoundsAfterFlyoutLayout();

    try {
      await startCapture({ format: state.recordFormat });

      if (captureAttemptId !== attemptId) {
        await stopCapture();
        state.recorder = {
          ...state.recorder,
          state: "idle",
        };
        render();
        syncBoundsAfterFlyoutLayout();
        return;
      }

      const started = await window.inkover.recordStart({ format: state.recordFormat });
      if (!started || captureAttemptId !== attemptId) {
        await stopCapture();
        if (captureAttemptId === attemptId) {
          state.recorder = {
            ...state.recorder,
            state: "idle",
          };
          render();
          syncBoundsAfterFlyoutLayout();
        }
        return;
      }

      captureAttemptId = 0;
    } catch (err) {
      if (captureAttemptId === attemptId) {
        captureAttemptId = 0;
        state.recorder = {
          ...state.recorder,
          state: "idle",
        };
        render();
        syncBoundsAfterFlyoutLayout();
      }
      console.error("[record] start", err);
      const message = err instanceof Error ? err.message : String(err);
      alert(message || "Unable to start recording for this display. Check screen recording permissions and try again.");
    }
  }

  // ---- Subscriptions ---------------------------------------------------

  window.inkover.onRecordStopRequest(() => void stopCapture());
  window.inkover.onRecordPauseRequest(() => pauseCapture());
  window.inkover.onRecordResumeRequest(() => resumeCapture());

  window.inkover.onRecorderStatus((s) => {
    const previousError = state.recorder.error;
    state.recorder = s;
    if (s.state === "idle" || s.state === "encoding") captureAttemptId = 0;
    render();
    if (s.error === "open-picker") {
      state.openFlyout = "record";
      render();
    } else if (s.error && s.error !== previousError) {
      state.openFlyout = "record";
      render();
      alert(s.error);
    }
  });

  window.inkover.onSettingsChange((s) => {
    state.settings = s;
  });

  window.inkover.onToolChange((tool) => {
    if (tool === state.activeTool) return;
    state.activeTool = tool;
    if (INK_GROUP.variants.some((v) => v.id === tool)) state.activeInk = tool;
    if (SHAPES_GROUP.variants.some((v) => v.id === tool)) state.activeShape = tool;
    if (PRESENT_GROUP.variants.some((v) => v.id === tool)) state.activePresent = tool;
    render();
  });
  window.inkover.onVisibilityChange(({ visible }) => {
    if (state.overlayVisible === visible) return;
    state.overlayVisible = visible;
    render();
  });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", queueVisibleBoundsSync);
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
