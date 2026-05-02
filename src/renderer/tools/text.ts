// Text tool. Click anywhere to drop an HTML <textarea> on top of the canvas at
// that position; on blur (or Enter without Shift) we commit it as a `text` shape.
// Doing the editing in the DOM rather than on the canvas means we get IME,
// selection, and accessibility for free.

import type { Tool, ToolContext, PointerEvent } from "./base";
import { newId } from "./base";

export class TextTool implements Tool {
  id = "text";
  cursor = "text";
  private editor: HTMLTextAreaElement | null = null;

  onPointerDown(ev: PointerEvent, ctx: ToolContext): void {
    if (this.editor) {
      this.commit(ctx);
      return;
    }
    const ta = document.createElement("textarea");
    ta.className = "inkover-text-editor";
    ta.style.position = "absolute";
    ta.style.left = ev.pos.x + "px";
    ta.style.top = ev.pos.y + "px";
    ta.style.minWidth = "120px";
    ta.style.minHeight = "32px";
    ta.style.font = `${Math.max(14, ctx.style().width * 6)}px ${getComputedStyle(document.body).fontFamily}`;
    ta.style.color = ctx.style().color;
    ta.style.background = "rgba(255,255,255,0.06)";
    ta.style.border = `1px dashed ${ctx.style().color}`;
    ta.style.borderRadius = "4px";
    ta.style.padding = "4px 6px";
    ta.style.outline = "none";
    ta.style.resize = "both";
    ta.style.zIndex = "9999";
    ta.dataset.posX = String(ev.pos.x);
    ta.dataset.posY = String(ev.pos.y);
    ta.addEventListener("blur", () => this.commit(ctx));
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.commit(ctx);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancel();
      }
    });
    document.body.appendChild(ta);
    requestAnimationFrame(() => ta.focus());
    this.editor = ta;
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
  onDeactivate(ctx: ToolContext): void {
    this.commit(ctx);
  }

  private commit(ctx: ToolContext): void {
    if (!this.editor) return;
    const text = this.editor.value.trim();
    const x = Number(this.editor.dataset.posX);
    const y = Number(this.editor.dataset.posY);
    const size = Math.max(14, ctx.style().width * 6);
    this.editor.remove();
    this.editor = null;
    if (!text) return;
    const style = ctx.style();
    ctx.engine.addShape({
      id: newId(),
      kind: "text",
      x,
      y,
      text,
      font: getComputedStyle(document.body).fontFamily,
      size,
      style,
    });
    ctx.history.push(ctx.engine.getShapes());
  }

  private cancel(): void {
    this.editor?.remove();
    this.editor = null;
  }
}
