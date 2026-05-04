import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const smokeRecordingsDir = path.join(workspaceRoot, ".smoke-recordings");
const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";

const consoleErrors = [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(factory, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await factory();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function attachDiagnostics(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`[${label}] console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(`[${label}] page error: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function getWindowsByUrlFragment(electronApp, fragment) {
  return electronApp
    .windows()
    .filter((page) => !page.isClosed() && page.url().includes(fragment));
}

async function waitForToolbarWindow(electronApp) {
  const toolbar = await waitFor(async () => {
    const pages = await getWindowsByUrlFragment(electronApp, "toolbar.html");
    return pages[0] ?? null;
  }, 15000, "toolbar window");
  attachDiagnostics(toolbar, "toolbar");
  await toolbar.waitForLoadState("domcontentloaded");
  await toolbar.locator("#root").waitFor({ state: "visible" });
  return toolbar;
}

async function waitForVisibleOverlayWindow(electronApp) {
  const overlay = await waitFor(async () => {
    const pages = await getWindowsByUrlFragment(electronApp, "overlay.html");
    for (const page of pages) {
      try {
        const visible = await page.evaluate(() => document.body.dataset.visible === "true");
        if (visible) return page;
      } catch {
        // Window may still be booting.
      }
    }
    return null;
  }, 15000, "overlay window");
  attachDiagnostics(overlay, "overlay");
  await overlay.waitForLoadState("domcontentloaded");
  await overlay.locator("#inkover-canvas").waitFor({ state: "attached" });
  return overlay;
}

async function installRecorderDiagnostics(toolbar) {
  await toolbar.evaluate(() => {
    if (window.__smokeRecorderDiagnosticsInstalled) return;
    window.__smokeRecorderDiagnosticsInstalled = true;
    window.__smokeRecorderEvents = [];
    window.__smokeRecorderAlerts = [];
    window.alert = (message) => {
      window.__smokeRecorderAlerts.push(String(message));
    };
    window.inkover.onRecorderStatus((status) => {
      window.__smokeRecorderEvents.push({
        state: status.state,
        error: status.error ?? null,
        outputPath: status.outputPath ?? null,
      });
    });
  });
}

async function getRecorderDiagnostics(toolbar) {
  return toolbar.evaluate(() => {
    const actionButton = document.querySelector("#rec-stop, #rec-start");
    return {
      buttonId: actionButton instanceof HTMLElement ? actionButton.id : null,
      buttonText: actionButton instanceof HTMLElement ? actionButton.innerText.trim() : null,
      alerts: window.__smokeRecorderAlerts ?? [],
      events: window.__smokeRecorderEvents ?? [],
    };
  });
}

async function clickTool(toolbar, toolId) {
  const groupByTool = new Map([
    ["pen", "ink"],
    ["highlighter", "ink"],
    ["eraser", "ink"],
    ["line", "shapes"],
    ["arrow", "shapes"],
    ["rect", "shapes"],
    ["ellipse", "shapes"],
    ["laser", "presentation"],
    ["spotlight", "presentation"],
    ["magnifier", "presentation"],
    ["blur", "presentation"],
  ]);

  if (toolId === "select" || toolId === "text") {
    await toolbar.locator(`[data-tool="${toolId}"]`).click();
    return;
  }

  const groupId = groupByTool.get(toolId);
  assert(groupId, `No toolbar group mapping found for tool ${toolId}.`);
  await toolbar.locator(`[data-group="${groupId}"] .tb-btn--group`).click();
  const option = toolbar.locator(`[data-flyout-tool="${toolId}"]`);
  await option.waitFor({ state: "visible" });
  await option.click();
}

async function waitForActiveTool(overlay, toolId) {
  await overlay.waitForFunction(
    (expectedTool) => document.body.dataset.tool === expectedTool,
    toolId,
    { timeout: 5000 },
  );
}

async function canvasBox(overlay) {
  const box = await overlay.locator("#inkover-canvas").boundingBox();
  assert(box, "Overlay canvas was not measurable.");
  return box;
}

async function drawGesture(overlay, from, to) {
  const box = await canvasBox(overlay);
  await overlay.mouse.move(box.x + from.x, box.y + from.y);
  await overlay.mouse.down();
  await overlay.mouse.move(box.x + to.x, box.y + to.y, { steps: 12 });
  await overlay.mouse.up();
}

function createRegion(box, xRatio, yRatio, width, height) {
  return {
    x: Math.max(80, Math.min(Math.round(box.width * xRatio), box.width - width - 80)),
    y: Math.max(80, Math.min(Math.round(box.height * yRatio), box.height - height - 80)),
    width,
    height,
  };
}

function regionPoint(region, xRatio, yRatio) {
  return {
    x: region.x + Math.round(region.width * xRatio),
    y: region.y + Math.round(region.height * yRatio),
  };
}

async function countPaintedPixels(overlay, region) {
  return overlay.evaluate(({ x, y, width, height }) => {
    const canvas = document.getElementById("inkover-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Overlay canvas missing.");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Overlay context missing.");
    const dpr = window.devicePixelRatio || 1;
    const image = ctx.getImageData(
      Math.round(x * dpr),
      Math.round(y * dpr),
      Math.max(1, Math.round(width * dpr)),
      Math.max(1, Math.round(height * dpr)),
    ).data;
    let painted = 0;
    for (let index = 3; index < image.length; index += 4) {
      if (image[index] > 0) painted += 1;
    }
    return painted;
  }, region);
}

async function assertRegionPainted(toolbar, overlay, toolId, region, from, to, message) {
  await clickTool(toolbar, toolId);
  await waitForActiveTool(overlay, toolId);
  const before = await countPaintedPixels(overlay, region);
  await drawGesture(overlay, from, to);
  const after = await countPaintedPixels(overlay, region);
  assert(after > before, message);
}

async function waitForSavedRecording(extension, timeoutMs = 10000) {
  const recordingPath = await waitFor(async () => {
    const entries = await fs.readdir(smokeRecordingsDir).catch(() => []);
    const match = entries.find((entry) => entry.endsWith(`.${extension}`));
    return match ? path.join(smokeRecordingsDir, match) : null;
  }, timeoutMs, `${extension} recording output`);
  const stat = await fs.stat(recordingPath);
  assert(stat.size > 0, "Smoke recording file was empty.");
  return recordingPath;
}

async function clearSavedRecordings() {
  await fs.rm(smokeRecordingsDir, { recursive: true, force: true });
  await fs.mkdir(smokeRecordingsDir, { recursive: true });
}

async function ensureRecordFlyoutOpen(toolbar) {
  const flyout = toolbar.locator('[data-flyout="record"]');
  if (await flyout.isVisible().catch(() => false)) return;
  await toolbar.locator("#record-toggle").click();
  await flyout.waitFor({ state: "visible" });
}

async function focusToolbar(toolbar) {
  await toolbar.bringToFront();
  await toolbar.locator("#visibility").focus();
}

async function assertToolbarKeyboardShortcuts(toolbar, overlay) {
  await focusToolbar(toolbar);
  await toolbar.keyboard.press("KeyP");
  await waitForActiveTool(overlay, "pen");
  await expectClass(toolbar, '[data-group="ink"] .tb-btn--group', "is-active");

  await focusToolbar(toolbar);
  await toolbar.keyboard.press("Escape");
  await overlay.waitForFunction(() => document.body.dataset.visible === "false", undefined, { timeout: 5000 });

  await focusToolbar(toolbar);
  await toolbar.keyboard.press("Escape");
  await overlay.waitForFunction(() => document.body.dataset.visible === "true", undefined, { timeout: 5000 });

  await focusToolbar(toolbar);
  await toolbar.keyboard.press(`${primaryModifier}+Shift+R`);
  await toolbar.locator('[data-flyout="record"]').waitFor({ state: "visible", timeout: 5000 });

  await focusToolbar(toolbar);
  await toolbar.keyboard.press("KeyV");
  await waitForActiveTool(overlay, "select");
  await expectClass(toolbar, '[data-tool="select"]', "is-active");
}

async function assertRecordingFile(recordingPath, format) {
  const bytes = await fs.readFile(recordingPath);
  assert(bytes.length > 0, `${format} recording file was empty.`);
  if (format === "gif") {
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "GIF8", "Saved GIF did not have a GIF header.");
    return;
  }
  assert.equal(path.extname(recordingPath), ".webm", "Saved recording did not use the .webm extension.");
}

async function recordRoundTrip(toolbar, format) {
  await clearSavedRecordings();
  await ensureRecordFlyoutOpen(toolbar);
  await toolbar.locator(`[data-rec-format="${format}"]`).click();
  await expectClass(toolbar, `[data-rec-format="${format}"]`, "is-active");
  await toolbar.locator("#rec-start").click();
  const stopButton = toolbar.locator("#rec-stop");
  try {
    await stopButton.waitFor({ state: "visible", timeout: 10000 });
  } catch (error) {
    const diagnostics = await getRecorderDiagnostics(toolbar);
    throw new Error(
      `Recording failed to enter active stop state for ${format}. `
      + `Button=${diagnostics.buttonId ?? "none"}:${diagnostics.buttonText ?? ""}. `
      + `Alerts=${JSON.stringify(diagnostics.alerts)}. `
      + `Events=${JSON.stringify(diagnostics.events)}. `
      + `Cause=${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await delay(150);
  if (await stopButton.isVisible().catch(() => false)) {
    await stopButton.click();
  }
  await toolbar.locator("#rec-start").waitFor({ state: "visible", timeout: format === "gif" ? 20000 : 10000 });
  const recordingPath = await waitForSavedRecording(format, format === "gif" ? 20000 : 10000);
  await assertRecordingFile(recordingPath, format);
}

async function run() {
  await fs.rm(smokeRecordingsDir, { recursive: true, force: true });
  await fs.mkdir(smokeRecordingsDir, { recursive: true });

  const electronApp = await electron.launch({
    args: ["."],
    cwd: workspaceRoot,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      INKOVER_SMOKE_MODE: "1",
      INKOVER_SMOKE_SAVE_DIR: smokeRecordingsDir,
    },
  });

  try {
    const toolbar = await waitForToolbarWindow(electronApp);
    const overlay = await waitForVisibleOverlayWindow(electronApp);
    await installRecorderDiagnostics(toolbar);

    assert.equal(await toolbar.evaluate(() => Boolean(window.inkover)), true, "Toolbar preload bridge missing.");
    assert.equal(await overlay.evaluate(() => Boolean(window.inkover)), true, "Overlay preload bridge missing.");
    await assertToolbarKeyboardShortcuts(toolbar, overlay);

    const tools = [
      "select",
      "pen",
      "highlighter",
      "eraser",
      "line",
      "arrow",
      "rect",
      "ellipse",
      "text",
      "laser",
      "spotlight",
      "magnifier",
      "blur",
    ];

    for (const toolId of tools) {
      await clickTool(toolbar, toolId);
      await waitForActiveTool(overlay, toolId);
    }

    const box = await canvasBox(overlay);
    const penRegion = createRegion(box, 0.42, 0.18, 150, 110);
    const highlighterRegion = createRegion(box, 0.42, 0.32, 200, 110);
    const lineRegion = createRegion(box, 0.42, 0.46, 220, 60);
    const arrowRegion = createRegion(box, 0.42, 0.56, 220, 90);
    const ellipseRegion = createRegion(box, 0.42, 0.68, 200, 130);
    const rectRegion = createRegion(box, 0.66, 0.28, 170, 120);
    const textRegion = createRegion(box, 0.66, 0.52, 220, 90);

    await assertRegionPainted(
      toolbar,
      overlay,
      "pen",
      penRegion,
      regionPoint(penRegion, 0.12, 0.18),
      regionPoint(penRegion, 0.88, 0.82),
      "Pen stroke did not render on the overlay canvas.",
    );

    await assertRegionPainted(
      toolbar,
      overlay,
      "highlighter",
      highlighterRegion,
      regionPoint(highlighterRegion, 0.08, 0.5),
      regionPoint(highlighterRegion, 0.92, 0.5),
      "Highlighter stroke did not render on the overlay canvas.",
    );

    await assertRegionPainted(
      toolbar,
      overlay,
      "line",
      lineRegion,
      regionPoint(lineRegion, 0.08, 0.5),
      regionPoint(lineRegion, 0.92, 0.5),
      "Line tool did not commit a line to the overlay canvas.",
    );

    await assertRegionPainted(
      toolbar,
      overlay,
      "arrow",
      arrowRegion,
      regionPoint(arrowRegion, 0.08, 0.25),
      regionPoint(arrowRegion, 0.92, 0.75),
      "Arrow tool did not commit an arrow to the overlay canvas.",
    );

    await assertRegionPainted(
      toolbar,
      overlay,
      "ellipse",
      ellipseRegion,
      regionPoint(ellipseRegion, 0.12, 0.12),
      regionPoint(ellipseRegion, 0.88, 0.88),
      "Ellipse tool did not commit an ellipse to the overlay canvas.",
    );

    await assertRegionPainted(
      toolbar,
      overlay,
      "rect",
      rectRegion,
      regionPoint(rectRegion, 0.12, 0.12),
      regionPoint(rectRegion, 0.88, 0.88),
      "Rectangle tool did not commit a rectangle to the overlay canvas.",
    );

    await clickTool(toolbar, "eraser");
    await waitForActiveTool(overlay, "eraser");
    const rectPixelsBeforeErase = await countPaintedPixels(overlay, rectRegion);
    await drawGesture(
      overlay,
      regionPoint(rectRegion, 0.5, 0.5),
      regionPoint(rectRegion, 0.58, 0.58),
    );
    const rectPixelsAfterErase = await countPaintedPixels(overlay, rectRegion);
    assert(rectPixelsAfterErase < rectPixelsBeforeErase, "Eraser did not remove the target shape.");

    await clickTool(toolbar, "text");
    await waitForActiveTool(overlay, "text");
    const textPixelsBefore = await countPaintedPixels(overlay, textRegion);
    await overlay.mouse.click(box.x + textRegion.x + 20, box.y + textRegion.y + 20);
    const editor = overlay.locator("textarea.inkover-text-editor");
    await editor.waitFor({ state: "visible" });
    await editor.fill("Smoke text");
    await editor.press("Enter");
    await editor.waitFor({ state: "detached" });
    const textPixelsAfter = await waitFor(async () => {
      const nextPixelCount = await countPaintedPixels(overlay, textRegion);
      return nextPixelCount > textPixelsBefore ? nextPixelCount : null;
    }, 5000, "text commit repaint");
    assert(textPixelsAfter > textPixelsBefore, "Text tool did not commit text to the overlay canvas.");

    await clickTool(toolbar, "laser");
    await waitForActiveTool(overlay, "laser");
    await overlay.mouse.move(box.x + 560, box.y + 120);
    await overlay.mouse.move(box.x + 640, box.y + 170, { steps: 6 });
    await overlay.waitForFunction(
      () => (document.querySelectorAll(".inkover-laser-layer > div").length ?? 0) > 0,
      undefined,
      { timeout: 5000 },
    );

    await clickTool(toolbar, "spotlight");
    await waitForActiveTool(overlay, "spotlight");
    await overlay.mouse.move(box.x + 620, box.y + 150);
    await overlay.waitForFunction(
      () => {
        const layer = document.querySelector(".inkover-spotlight-layer");
        return layer instanceof HTMLDivElement && layer.style.background.includes("radial-gradient");
      },
      undefined,
      { timeout: 5000 },
    );

    await clickTool(toolbar, "magnifier");
    await waitForActiveTool(overlay, "magnifier");
    await overlay.mouse.move(box.x + 660, box.y + 180);
    await overlay.locator(".inkover-magnifier-layer").waitFor({ state: "visible", timeout: 5000 });

    await clickTool(toolbar, "blur");
    await waitForActiveTool(overlay, "blur");
    const blurCountBefore = await overlay.locator(".inkover-blur-region[data-capture-state='ready']").count();
    await drawGesture(overlay, { x: 620, y: 220 }, { x: 710, y: 310 });
    await waitFor(
      async () => (await overlay.locator(".inkover-blur-region[data-capture-state='ready']").count()) > blurCountBefore,
      5000,
      "blur region to become capture-backed",
    );

    await toolbar.locator("#visibility").click();
    await overlay.waitForFunction(() => document.body.dataset.visible === "false", undefined, { timeout: 5000 });
    await toolbar.locator("#visibility").click();
    await overlay.waitForFunction(() => document.body.dataset.visible === "true", undefined, { timeout: 5000 });

    await recordRoundTrip(toolbar, "webm");
    await recordRoundTrip(toolbar, "gif");

    if (consoleErrors.length > 0) {
      throw new Error(`Renderer console errors were captured during smoke testing:\n${consoleErrors.join("\n")}`);
    }

    console.log("Electron smoke test passed.");
  } finally {
    await electronApp.close();
  }
}

async function expectClass(page, selector, className) {
  await page.waitForFunction(
    ({ nextSelector, nextClassName }) => {
      const node = document.querySelector(nextSelector);
      return node instanceof HTMLElement && node.classList.contains(nextClassName);
    },
    { nextSelector: selector, nextClassName: className },
    { timeout: 5000 },
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});