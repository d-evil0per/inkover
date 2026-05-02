// Floating draggable toolbar window. Stays alongside whichever overlay the user is
// currently drawing on. Implemented as a frameless, always-on-top BrowserWindow.

import { BrowserWindow, screen } from "electron";

export class ToolbarWindow {
  private win: BrowserWindow | null = null;

  constructor(
    private opts: {
      rendererBaseUrl: string;
      preloadPath: string;
    },
  ) {}

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      return;
    }
    const primary = screen.getPrimaryDisplay();
    // Wider than the visible toolbar pill so CSS tooltips have room to slide
    // out to the right of the buttons, fully inside the window's content area.
    const width = 220;
    const height = 640;
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
      skipTaskbar: true,
      backgroundColor: "#00000000",
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

  // Resize the toolbar window width (and optionally height). Keeps the
  // current y-position and attempts to preserve the center alignment.
  setWidth(w: number, h?: number): void {
    if (!this.win || this.win.isDestroyed()) return;
    const bounds = this.win.getBounds();
    const newW = Math.max(220, w);
    const newH = h ?? bounds.height;
    // Keep left anchored (x) the same so the pill stays in place.
    this.win.setBounds({ x: bounds.x, y: bounds.y, width: newW, height: newH });
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
}
