// Floating draggable toolbar window. Stays alongside whichever overlay the user is
// currently drawing on. Implemented as a frameless, always-on-top BrowserWindow.

import { BrowserWindow, screen, type Rectangle } from "electron";
import { getWindowIconPath } from "./app-icon";

export class ToolbarWindow {
  private win: BrowserWindow | null = null;
  private currentDisplayId: number | null = null;
  private visibleBounds: Rectangle | null = null;
  private boundsChangeListeners = new Set<(bounds: Rectangle) => void>();
  private displayChangeListeners = new Set<(displayId: number) => void>();
  private closedListeners = new Set<() => void>();

  private static readonly INITIAL_WIDTH = 220;
  private static readonly INITIAL_MAX_HEIGHT = 760;
  private static readonly MIN_VISIBLE_WIDTH = 44;
  private static readonly MIN_VISIBLE_HEIGHT = 44;
  private static readonly WINDOW_GUTTER_LEFT = 8;
  private static readonly WINDOW_GUTTER_RIGHT = 32;

  constructor(
    private opts: {
      rendererBaseUrl: string;
      preloadPath: string;
    },
  ) {}

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.updateCurrentDisplay();
      this.win.show();
      this.win.focus();
      return;
    }
    const primary = screen.getPrimaryDisplay();
    // Wider than the visible toolbar pill so CSS tooltips have room to slide
    // out to the right of the buttons, fully inside the window's content area.
    const width = ToolbarWindow.INITIAL_WIDTH;
    const height = this.computePreferredHeight(primary.workArea.height);
    const x = primary.workArea.x + 24;
    const y = primary.workArea.y + Math.max(24, Math.round((primary.workArea.height - height) / 2));

    this.win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: process.platform === "darwin",
      backgroundColor: "#00000000",
      icon: process.platform === "darwin" ? undefined : getWindowIconPath(),
      // Disable the native OS shadow — on macOS it paints a rectangular
      // drop-shadow around the entire window bounds (220×640), creating a
      // visible dark "frame" around the much smaller toolbar pill. We do our
      // own pill-shaped shadow in CSS.
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: this.opts.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    // Toolbar lives at the SAME elevation as the overlays (screen-saver).
    // Overlays cover the whole screen, so without this they'd capture pointer
    // events on top of the toolbar — meaning a stray pen-stroke would draw
    // OVER the dock. Putting both at the same level and re-elevating the
    // toolbar (via bringToFront) after the overlay shows keeps the dock on top.
    this.win.setAlwaysOnTop(true, "screen-saver");
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.on("move", () => this.handleBoundsChanged());
    this.win.on("resize", () => this.handleBoundsChanged());
    this.win.once("closed", () => {
      this.win = null;
      this.visibleBounds = null;
      for (const listener of this.closedListeners) {
        listener();
      }
    });
    this.handleBoundsChanged();

    void this.win.loadURL(`${this.opts.rendererBaseUrl}/toolbar.html`);
    this.win.once("ready-to-show", () => {
      this.win?.showInactive();
      this.bringToFront();
    });
  }

  /** Re-assert always-on-top so the toolbar is above other screen-saver-level
   *  windows (notably the overlays). Call this whenever the overlay is shown. */
  bringToFront(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setAlwaysOnTop(true, "screen-saver");
    this.win.moveTop();
  }

  show(): void {
    this.win?.showInactive();
  }

  hide(): void {
    this.win?.hide();
  }

  toggle(): void {
    if (!this.win) return this.open();
    if (this.win.isVisible()) this.win.hide();
    else this.win.showInactive();
  }

  webContents() {
    return this.win?.webContents ?? null;
  }

  getCurrentDisplayId(): number | null {
    this.updateCurrentDisplay();
    return this.currentDisplayId ?? screen.getPrimaryDisplay().id;
  }

  getBounds(): Rectangle | null {
    return this.win && !this.win.isDestroyed() ? this.win.getBounds() : null;
  }

  getVisibleBounds(): Rectangle | null {
    return this.visibleBounds;
  }

  setVisibleBounds(bounds: Rectangle | null): void {
    this.visibleBounds = bounds
      ? {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        }
      : null;
    const didFit = this.fitToVisibleBounds();
    if (!didFit) this.handleBoundsChanged();
  }

  onDisplayChange(listener: (displayId: number) => void): () => void {
    this.displayChangeListeners.add(listener);
    const displayId = this.getCurrentDisplayId();
    if (displayId != null) listener(displayId);
    return () => this.displayChangeListeners.delete(listener);
  }

  onBoundsChange(listener: (bounds: Rectangle) => void): () => void {
    this.boundsChangeListeners.add(listener);
    const bounds = this.getBounds();
    if (bounds) listener(bounds);
    return () => this.boundsChangeListeners.delete(listener);
  }

  onClosed(listener: () => void): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }

  private handleBoundsChanged(): void {
    this.updateCurrentDisplay();
    this.applyWindowShape();
    const bounds = this.getBounds();
    if (!bounds) return;
    for (const listener of this.boundsChangeListeners) {
      listener(bounds);
    }
  }

  private computePreferredHeight(workAreaHeight: number): number {
    return Math.max(
      ToolbarWindow.MIN_VISIBLE_HEIGHT,
      Math.min(ToolbarWindow.INITIAL_MAX_HEIGHT, workAreaHeight - 48),
    );
  }

  private fitToVisibleBounds(): boolean {
    if (!this.win || this.win.isDestroyed() || !this.visibleBounds) return false;

    const windowBounds = this.win.getBounds();
    const display = screen.getDisplayMatching(windowBounds);

    // Renderer reports visibleBounds in window-local coordinates: the bounding
    // rect that encloses the pill plus any open flyout. We want the native
    // window to be exactly that rect (plus a little gutter on the right so a
    // flyout's drop-shadow has room) at the same screen position.
    //
    // Anchor to the LEFT side of the renderer-reported rect: pill x stays put
    // on screen even though the window grows/shrinks horizontally.
    const desiredWidth = Math.max(
      ToolbarWindow.MIN_VISIBLE_WIDTH + ToolbarWindow.WINDOW_GUTTER_LEFT + ToolbarWindow.WINDOW_GUTTER_RIGHT,
      this.visibleBounds.width + ToolbarWindow.WINDOW_GUTTER_LEFT + ToolbarWindow.WINDOW_GUTTER_RIGHT,
    );
    const desiredHeight = Math.max(ToolbarWindow.MIN_VISIBLE_HEIGHT, this.visibleBounds.height);

    // Convert window-local visibleBounds.x/y to screen coords, then back off
    // by the left gutter so the pill stays at the same screen x. Y is NOT
    // shifted here (the pill stays put vertically — it sits inside the
    // window centered by CSS, so what matters is keeping the window's screen
    // y stable).
    const target = {
      x: windowBounds.x + this.visibleBounds.x - ToolbarWindow.WINDOW_GUTTER_LEFT,
      y: windowBounds.y,
      width: desiredWidth,
      height: desiredHeight,
    };

    if (target.width <= 0 || target.height <= 0) return false;

    const clamped = {
      x: Math.max(display.workArea.x, Math.min(target.x, display.workArea.x + display.workArea.width - target.width)),
      y: Math.max(display.workArea.y, Math.min(target.y, display.workArea.y + display.workArea.height - target.height)),
      width: Math.min(target.width, display.workArea.width),
      height: Math.min(target.height, display.workArea.height),
    };

    // After we resize, the pill+flyout content lives at (LEFT_GUTTER, 0)
    // inside the new window; record that so the next visibleBounds call from
    // the renderer is interpreted relative to the new origin.
    this.visibleBounds = {
      x: ToolbarWindow.WINDOW_GUTTER_LEFT,
      y: 0,
      width: Math.min(
        this.visibleBounds.width,
        Math.max(0, clamped.width - ToolbarWindow.WINDOW_GUTTER_LEFT - ToolbarWindow.WINDOW_GUTTER_RIGHT),
      ),
      height: Math.min(this.visibleBounds.height, clamped.height),
    };

    const unchanged =
      windowBounds.x === clamped.x &&
      windowBounds.y === clamped.y &&
      windowBounds.width === clamped.width &&
      windowBounds.height === clamped.height;

    if (unchanged) return false;

    this.win.setBounds(clamped);
    return true;
  }

  private applyWindowShape(): void {
    if (!this.win || this.win.isDestroyed() || typeof this.win.setShape !== "function") return;

    const bounds = this.win.getBounds();
    // Keep the toolbar window rectangular. We already resize the native window
    // itself to the exact DOM bounds we want to show, so applying a second
    // native shape clip here is redundant and has proven brittle for flyouts
    // on Windows. The full-rect shape avoids trimming while preserving the
    // measured visible bounds for overlay exclusion logic.
    this.win.setShape([{ x: 0, y: 0, width: bounds.width, height: bounds.height }]);
  }

  private updateCurrentDisplay(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const nextDisplayId = screen.getDisplayMatching(this.win.getBounds()).id;
    if (nextDisplayId === this.currentDisplayId) return;
    this.currentDisplayId = nextDisplayId;
    for (const listener of this.displayChangeListeners) {
      listener(nextDisplayId);
    }
  }
}
