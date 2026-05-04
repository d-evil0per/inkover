// OverlayManager owns one transparent, full-screen, click-through-capable window per
// connected display. It listens for display geometry changes and keeps overlays in sync.
//
// Why one window per display?
//   - macOS / Windows / Linux all behave better with native windows pinned to a single
//     screen than with one giant cross-display window.
//   - Per-display windows can be independently shown/hidden (e.g. annotate on the
//     presenter monitor while the audience monitor stays clean).
//
// Click-through:
//   - When the user is *not* drawing we want clicks to pass through to the underlying
//     desktop. We toggle setIgnoreMouseEvents(true, { forward: true }) so the renderer
//     still gets `mousemove` events for the laser pointer / spotlight.
//   - The renderer flips this on pointerdown of a drawing tool by calling
//     window.inkover... actually no, it calls back via IPC; see ipc-handlers.

import { BrowserWindow, screen, type Display, type Rectangle } from "electron";
import { IPC } from "../shared/ipc-channels";
import type { DisplayInfo, Rect } from "../shared/types";

interface OverlayWindow {
  display: Display;
  window: BrowserWindow;
}

export class OverlayManager {
  private overlays = new Map<number, OverlayWindow>();
  private visible = false;
  private activeDisplayId: number | null = null;
  private clickThrough = true;
  private pointerOverToolbar = false;
  private toolbarExclusionBounds: Rect | null = null;
  private rendererBaseUrl: string;
  private preloadPath: string;

  constructor(opts: { rendererBaseUrl: string; preloadPath: string }) {
    this.rendererBaseUrl = opts.rendererBaseUrl;
    this.preloadPath = opts.preloadPath;
  }

  /** Create a window for every connected display and register screen-change listeners. */
  start(): void {
    for (const display of screen.getAllDisplays()) {
      this.createForDisplay(display);
    }
    screen.on("display-added", (_e, d) => this.createForDisplay(d));
    screen.on("display-removed", (_e, d) => this.destroyForDisplay(d.id));
    screen.on("display-metrics-changed", (_e, d) => this.repositionForDisplay(d));
  }

  /** Show the overlay for the selected display and hide the rest. */
  show(displayId?: number | null): void {
    if (displayId != null) this.activeDisplayId = displayId;
    else if (this.activeDisplayId == null) this.activeDisplayId = screen.getPrimaryDisplay().id;
    this.visible = true;
    this.syncOverlayWindows();
  }

  /** Hide all overlays. */
  hide(): void {
    this.visible = false;
    this.syncOverlayWindows();
  }

  toggle(displayId?: number | null): void {
    if (this.visible) this.hide();
    else this.show(displayId);
  }

  isVisible(): boolean {
    return this.visible;
  }

  setActiveDisplay(displayId: number | null): void {
    if (displayId == null || this.activeDisplayId === displayId) return;
    this.activeDisplayId = displayId;
    if (this.visible) this.syncOverlayWindows();
  }

  setToolbarExclusionBounds(bounds: Rect | null): void {
    this.toolbarExclusionBounds = bounds;
    if (this.visible) this.syncOverlayWindows();
  }

  /** Forward an arbitrary IPC message to every overlay window. */
  broadcast(channel: string, payload: unknown): void {
    for (const ov of this.overlays.values()) {
      if (!ov.window.isDestroyed()) ov.window.webContents.send(channel, payload);
    }
  }

  /** Forward a message to a single overlay window. */
  broadcastToDisplay(channel: string, payload: unknown, displayId: number | null): void {
    if (displayId == null) return;
    const ov = this.overlays.get(displayId);
    if (!ov || ov.window.isDestroyed()) return;
    ov.window.webContents.send(channel, payload);
  }

  /** Toggle pointer-events through for the active overlay. */
  setClickThrough(clickThrough: boolean): void {
    this.clickThrough = clickThrough;
    if (this.visible) this.syncOverlayWindows();
  }

  setPointerOverToolbar(pointerOverToolbar: boolean): void {
    if (this.pointerOverToolbar === pointerOverToolbar) return;
    this.pointerOverToolbar = pointerOverToolbar;
    if (this.visible) this.syncOverlayWindows();
  }

  getDisplays(): DisplayInfo[] {
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      primary: d.id === screen.getPrimaryDisplay().id,
    }));
  }

  private overlayWindowLevel(): "screen-saver" | "floating" {
    // Windows and Linux need the highest native level so the transparent
    // annotation window stays above other apps instead of only over the desktop.
    // On macOS we keep the overlay one step below the toolbar to avoid native
    // reordering that can leave the dock unreachable while drawing.
    return process.platform === "darwin" ? "floating" : "screen-saver";
  }

  private createForDisplay(display: Display): void {
    if (this.overlays.has(display.id)) return;

    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: true,
      show: false,
      // `kiosk` is too aggressive on macOS; we use level "screen-saver" instead so
      // we float above normal windows but the user can still Cmd-Tab away.
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        additionalArguments: [`--inkover-display=${display.id}`],
      },
    });

    // Z-order strategy:
    //   - macOS: toolbar "screen-saver", overlay "floating"
    //   - Windows/Linux: toolbar and overlay both use "screen-saver"
    //
    // Windows in particular can leave a transparent "floating" overlay behind
    // other applications, which makes annotation look like it only works on the
    // desktop. We keep the toolbar clickable by reasserting its z-order from the
    // owning main-process paths after the overlay is shown.
    win.setAlwaysOnTop(true, this.overlayWindowLevel());
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Begin in click-through mode so the user can interact with the desktop until
    // they pick a drawing tool.
    win.setIgnoreMouseEvents(true, { forward: true });

    const url = `${this.rendererBaseUrl}/overlay.html?displayId=${display.id}`;
    void win.loadURL(url);

    this.overlays.set(display.id, { display, window: win });
    if (this.activeDisplayId == null && display.id === screen.getPrimaryDisplay().id) {
      this.activeDisplayId = display.id;
    }
    this.syncOverlayWindow(display.id);
  }

  private destroyForDisplay(id: number): void {
    const ov = this.overlays.get(id);
    if (!ov) return;
    if (!ov.window.isDestroyed()) ov.window.destroy();
    this.overlays.delete(id);
  }

  private repositionForDisplay(display: Display): void {
    const ov = this.overlays.get(display.id);
    if (!ov) {
      this.createForDisplay(display);
      return;
    }
    ov.display = display;
    ov.window.setBounds(display.bounds);
  }

  private syncOverlayWindows(): void {
    for (const displayId of this.overlays.keys()) {
      this.syncOverlayWindow(displayId);
    }
  }

  private syncOverlayWindow(displayId: number): void {
    const ov = this.overlays.get(displayId);
    if (!ov || ov.window.isDestroyed()) return;

    const shouldShow = this.visible && this.activeDisplayId === displayId;
    if (shouldShow) {
      const display = screen.getAllDisplays().find((candidate) => candidate.id === displayId);
      if (display) {
        ov.display = display;
        ov.window.setBounds(display.bounds);
      }
      this.applyWindowShape(ov.window, ov.display.bounds, this.toolbarExclusionBounds);
      ov.window.setAlwaysOnTop(true, this.overlayWindowLevel());
      ov.window.showInactive();
      // forward: true keeps mousemove flowing so the laser/spotlight follows the cursor
      // even when clicks pass through.
      ov.window.setIgnoreMouseEvents(this.clickThrough || this.pointerOverToolbar, { forward: true });
      ov.window.webContents.send(IPC.OnVisibilityChange, { visible: true });
      return;
    }

    this.applyWindowShape(ov.window, ov.display.bounds, null);
    ov.window.setIgnoreMouseEvents(true, { forward: true });
    ov.window.webContents.send(IPC.OnVisibilityChange, { visible: false });
    ov.window.hide();
  }

  private applyWindowShape(win: BrowserWindow, bounds: Rectangle, exclusion: Rect | null): void {
    if (typeof win.setShape !== "function") return;

    const fullRect: Rectangle = { x: 0, y: 0, width: bounds.width, height: bounds.height };
    if (!exclusion) {
      win.setShape([fullRect]);
      return;
    }

    const hole = {
      x: Math.max(0, Math.min(bounds.width, Math.round(exclusion.x))),
      y: Math.max(0, Math.min(bounds.height, Math.round(exclusion.y))),
      width: Math.max(0, Math.min(bounds.width, Math.round(exclusion.width))),
      height: Math.max(0, Math.min(bounds.height, Math.round(exclusion.height))),
    };

    if (hole.width === 0 || hole.height === 0) {
      win.setShape([fullRect]);
      return;
    }

    const right = hole.x + hole.width;
    const bottom = hole.y + hole.height;
    const rects: Rectangle[] = [];

    if (hole.y > 0) rects.push({ x: 0, y: 0, width: bounds.width, height: hole.y });
    if (hole.x > 0) rects.push({ x: 0, y: hole.y, width: hole.x, height: hole.height });
    if (right < bounds.width) {
      rects.push({ x: right, y: hole.y, width: bounds.width - right, height: hole.height });
    }
    if (bottom < bounds.height) {
      rects.push({ x: 0, y: bottom, width: bounds.width, height: bounds.height - bottom });
    }

    win.setShape(rects.length ? rects : [fullRect]);
  }
}
