// Lightweight persistent store. We avoid pulling in `electron-store` directly here so the
// scaffold can be inspected without `npm install` — but the API mirrors it and you can
// swap to electron-store by changing this file alone.

import { app } from "electron";
import { promises as fs } from "fs";
import { join } from "path";
import { DEFAULT_SETTINGS, type Settings, type DrawingSnapshot } from "../shared/types";

type Listener = (s: Settings) => void;

export class Store {
  private settings: Settings = DEFAULT_SETTINGS;
  private readonly settingsPath: string;
  private readonly listeners = new Set<Listener>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.settingsPath = join(app.getPath("userData"), "settings.json");
  }

  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.settingsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<Settings>;
      this.settings = { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      // First run or corrupted — keep defaults and write them.
      await this.flush();
    }
  }

  get(): Settings {
    return this.settings;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    this.settings = { ...this.settings, ...patch };
    this.notify();
    await this.flush();
    return this.settings;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const l of this.listeners) l(this.settings);
  }

  /** Serialize writes so concurrent updates don't race. */
  private flush(): Promise<void> {
    const snapshot = this.settings;
    this.writeQueue = this.writeQueue.then(() =>
      fs.writeFile(this.settingsPath, JSON.stringify(snapshot, null, 2), "utf8"),
    );
    return this.writeQueue;
  }

  // ---- Drawings ----------------------------------------------------------

  drawingsDir(): string {
    return join(app.getPath("userData"), "drawings");
  }

  async saveDrawing(snap: DrawingSnapshot, name?: string): Promise<string> {
    const dir = this.drawingsDir();
    await fs.mkdir(dir, { recursive: true });
    const filename = (name ?? `inkover-${Date.now()}`) + ".inkover.json";
    const path = join(dir, filename);
    await fs.writeFile(path, JSON.stringify(snap, null, 2), "utf8");
    return path;
  }

  async loadDrawing(path: string): Promise<DrawingSnapshot | null> {
    try {
      const raw = await fs.readFile(path, "utf8");
      return JSON.parse(raw) as DrawingSnapshot;
    } catch {
      return null;
    }
  }
}
