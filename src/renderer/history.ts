// Linear undo/redo history. Each entry is a full snapshot of the shapes array.
// We keep snapshots small (vector data, not bitmaps) so this is cheap, and
// linear history is dramatically easier to reason about than a command stack
// when you mix freehand drawing with shape recognition that mutates the last
// stroke after the fact.

import type { Shape } from "@shared/types";

const MAX_HISTORY = 200;

export class History {
  private past: Shape[][] = [];
  private future: Shape[][] = [];

  push(state: Shape[]): void {
    this.past.push(clone(state));
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future.length = 0;
  }

  /** Replace the most recent snapshot — used for live coalescing during a stroke. */
  replaceTop(state: Shape[]): void {
    if (this.past.length === 0) {
      this.push(state);
      return;
    }
    this.past[this.past.length - 1] = clone(state);
  }

  undo(current: Shape[]): Shape[] | null {
    if (this.past.length === 0) return null;

    // `past` stores the committed snapshots, including the current state at the
    // top. Undo needs to discard that current snapshot and reveal the previous
    // one; otherwise the first undo after a change is a no-op.
    this.future.push(clone(current));
    this.past.pop();
    return this.past.length > 0 ? clone(this.past[this.past.length - 1]) : [];
  }

  redo(current: Shape[]): Shape[] | null {
    if (this.future.length === 0) return null;

    const next = this.future.pop()!;
    this.past.push(clone(next));
    return next;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }

  reset(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}

function clone<T>(v: T): T {
  // structuredClone is available in modern Electron renderers and matches the JSON shape we use.
  return typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
