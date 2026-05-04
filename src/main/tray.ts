// System tray menu. The tray is the user's "always there" entry point — it's the
// reason InkOver feels lighter than DrawPen, which lives in the menu bar with a
// fixed toolbar.

import { Menu, Tray, nativeImage, type NativeImage } from "electron";
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

function loadTrayIcon(): NativeImage {
  const candidateNames = process.platform === "darwin"
    ? ["trayTemplate.png", "trayTemplate@2x.png", "icon.png"]
    : [process.platform === "win32" ? "icon.ico" : "icon.png"];

  for (const candidateName of candidateNames) {
    const icon = nativeImage.createFromPath(join(__dirname, "..", "..", "assets", candidateName));
    if (icon.isEmpty()) {
      continue;
    }

    if (process.platform === "darwin") {
      if (candidateName.startsWith("trayTemplate")) {
        icon.setTemplateImage(true);
      }
      return icon.resize({ height: 18 });
    }

    return icon;
  }

  console.warn("[tray] No tray icon asset found; status item will be invisible.");
  return nativeImage.createEmpty();
}

export class TrayController {
  private tray: Tray | null = null;

  start(handlers: TrayHandlers): void {
    const icon = loadTrayIcon();
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
