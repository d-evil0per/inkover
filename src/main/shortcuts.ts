// Global hotkey registration. We keep the binding logic in one place so it is easy
// to re-register when the user changes the shortcut in settings.

import { globalShortcut } from "electron";

export interface ShortcutHandlers {
  toggle: () => void;
  toggleRecording: () => void;
}

export class ShortcutManager {
  private current: { toggleHotkey: string; recordHotkey: string } | null = null;

  register(opts: { toggleHotkey: string; recordHotkey: string }, handlers: ShortcutHandlers): void {
    this.unregister();
    this.current = opts;

    const ok1 = globalShortcut.register(opts.toggleHotkey, handlers.toggle);
    const ok2 = globalShortcut.register(opts.recordHotkey, handlers.toggleRecording);

    if (!ok1) console.warn(`[shortcuts] Failed to register toggle hotkey: ${opts.toggleHotkey}`);
    if (!ok2) console.warn(`[shortcuts] Failed to register record hotkey: ${opts.recordHotkey}`);
  }

  unregister(): void {
    if (!this.current) return;
    globalShortcut.unregister(this.current.toggleHotkey);
    globalShortcut.unregister(this.current.recordHotkey);
    this.current = null;
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.current = null;
  }
}
