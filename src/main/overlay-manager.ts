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

import { BrowserWindow, screen, type Display } from "electron";
import { join } from "path";
import { IPC } from "../shared/ipc-channels";
import type { DisplayInfo } from "../shared/types";

interface OverlayWindow {
  display: Display;
  window: BrowserWindow;
}

export class OverlayManager {
  private overlays = new Map<number, OverlayWindow>();
  private visible = false;
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

  /** Show all overlays and put them in interactive (drawing) mode. */
  show(): void {
    this.visible = true;
    for (const ov of this.overlays.values()) {
      ov.window.showInactive();
      ov.window.setIgnoreMouseEvents(false);
      ov.window.webContents.send(IPC.OnVisibilityChange, { visible: true });
    }
  }

  /** Hide all overlays. */
  hide(): void {
    this.visible = false;
    for (const ov of this.overlays.values()) {
      ov.window.webContents.send(IPC.OnVisibilityChange, { visible: false });
      ov.window.hide();
    }
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Forward an arbitrary IPC message to every overlay window. */
  broadcast(channel: string, payload: unknown): void {
    for (const ov of this.overlays.values()) {
      if (!ov.window.isDestroyed()) ov.window.webContents.send(channel, payload);
    }
  }

  /** Toggle pointer-events through for one overlay (called when entering/leaving idle). */
  setClickThrough(displayId: number, clickThrough: boolean): void {
    const ov = this.overlays.get(displayId);
    if (!ov) return;
    // forward: true keeps mousemove flowing so the laser/spotlight follows the cursor
    // even when clicks pass through.
    ov.window.setIgnoreMouseEvents(clickThrough, { forward: true });
  }

  getDisplays(): DisplayInfo[] {
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      primary: d.id === screen.getPrimaryDisplay().id,
    }));
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
    //   - Toolbar window:  level "screen-saver" (highest)
    //   - Overlay windows: level "pop-up-menu"  (one below)
    //
    // We deliberately put the toolbar one level above the overlay so the dock
    // is always clickable. If both lived at "screen-saver" macOS would re-order
    // them whenever the overlay started capturing pointer events, which made
    // the toolbar unreachable until the user pressed Esc to hide the overlay.
    // "pop-up-menu" (NSPopUpMenuWindowLevel) is still high enough to render on
    // top of normal app windows.
    win.setAlwaysOnTop(true, "pop-up-menu");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Begin in click-through mode so the user can interact with the desktop until
    // they pick a drawing tool.
    win.setIgnoreMouseEvents(true, { forward: true });

    const url = `${this.rendererBaseUrl}/overlay.html?displayId=${display.id}`;
    void win.loadURL(url);

    this.overlays.set(display.id, { display, window: win });
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
    ov.window.setBounds(display.bounds);
  }
}
