// System tray menu. The tray is the user's "always there" entry point — it's the
// reason InkOver feels lighter than DrawPen, which lives in the menu bar with a
// fixed toolbar.

import { Menu, Tray, nativeImage } from "electron";
import { join } from "path";

export interface TrayHandlers {
  toggleAnnotate: () => void;
  toggleToolbar: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  isRecording: () => boolean;
  isAnnotating: () => boolean;
  openSettings: () => void;
  quit: () => void;
}

export class TrayController {
  private tray: Tray | null = null;

  start(handlers: TrayHandlers): void {
    // We use a tiny template image so it adapts to dark/light menu bars on macOS.
    // In a real ship we'd embed an actual icon; for the scaffold we use an empty
    // 16x16 so the tray still appears.
    const icon = nativeImage.createEmpty();
    try {
      const iconPath = join(__dirname, "..", "..", "assets", "trayTemplate.png");
      const real = nativeImage.createFromPath(iconPath);
      if (!real.isEmpty()) {
        real.setTemplateImage(true);
      }
    } catch {
      // Fall through with empty icon.
    }
    this.tray = new Tray(icon);
    this.tray.setToolTip("InkOver — screen annotation");
    this.tray.on("click", () => handlers.toggleAnnotate());
    this.refresh(handlers);
  }

  refresh(handlers: TrayHandlers): void {
    if (!this.tray) return;
    const annotating = handlers.isAnnotating();
    const recording = handlers.isRecording();
    const menu = Menu.buildFromTemplate([
      {
        label: annotating ? "Stop annotating" : "Start annotating",
        accelerator: "CmdOrCtrl+Shift+P",
        click: () => handlers.toggleAnnotate(),
      },
      { label: "Show/hide toolbar", click: () => handlers.toggleToolbar() },
      { type: "separator" },
      recording
        ? { label: "Stop recording", click: () => handlers.stopRecording() }
        : {
            label: "Start screen recording…",
            accelerator: "CmdOrCtrl+Shift+R",
            click: () => handlers.startRecording(),
          },
      { type: "separator" },
      { label: "Settings…", click: () => handlers.openSettings() },
      { type: "separator" },
      { label: "Quit InkOver", click: () => handlers.quit() },
    ]);
    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
