// This module runs inside the hidden "capture" BrowserWindow created by
// Recorder.start(). It uses getUserMedia with chromeMediaSource to pull the
// screen, MediaRecorder to encode WebM, and an offscreen canvas + a tiny
// in-renderer GIF encoder to optionally export an animated GIF.
//
// We deliberately keep dependencies zero — gif.js is a great library but
// pulling it in via CDN here would break offline builds. Instead we expose
// `exportWebm()` and a small `exportGif()` that frame-samples the WebM via
// a <video> element and stitches frames using `OffscreenCanvas`. That gives
// us a respectable GIF without binary dependencies.

interface CaptureState {
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  chunks: Blob[];
  startedAt: number;
}

const state: CaptureState = { recorder: null, stream: null, chunks: [], startedAt: 0 };

export async function startCapture(sourceId: string): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    // Electron-specific constraints — the renderer process is granted access via
    // chromeMediaSource when the source id was returned by desktopCapturer.
    // `mandatory` is a non-standard Chromium constraint used by Electron's
    // desktopCapturer. We cast to any to bypass strict TS lib checks.
    video: {
      mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId },
    } as unknown as MediaTrackConstraints,
  });
  const mime = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = (e) => {
    if (e.data.size) state.chunks.push(e.data);
  };
  recorder.onstop = () => {
    void finalize().catch((err) => console.error("[recorder] finalize error", err));
  };
  recorder.start(250); // 250ms chunks → smooth seekbar in the resulting webm
  state.recorder = recorder;
  state.stream = stream;
  state.chunks = [];
  state.startedAt = performance.now();
}

export function pauseCapture(): void {
  if (state.recorder?.state === "recording") state.recorder.pause();
}
export function resumeCapture(): void {
  if (state.recorder?.state === "paused") state.recorder.resume();
}

export async function stopCapture(): Promise<void> {
  if (!state.recorder) return;
  if (state.recorder.state !== "inactive") {
    await new Promise<void>((resolve) => {
      state.recorder!.addEventListener("stop", () => resolve(), { once: true });
      state.recorder!.stop();
    });
  }
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

async function finalize(): Promise<void> {
  const webm = new Blob(state.chunks, { type: state.recorder?.mimeType ?? "video/webm" });
  const wantsGif = new URLSearchParams(location.search).get("format") === "gif";
  if (wantsGif) {
    const gif = await encodeGif(webm);
    const ab = await gif.arrayBuffer();
    await window.inkover.recordSaveBlob("gif", ab, `inkover-${Date.now()}.gif`);
  } else {
    const ab = await webm.arrayBuffer();
    await window.inkover.recordSaveBlob("webm", ab, `inkover-${Date.now()}.webm`);
  }
}

function pickMimeType(): string {
  // Prefer VP9 in WebM for size, fall back to VP8 / generic webm.
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const c of candidates) if (MediaRecorder.isTypeSupported(c)) return c;
  return "video/webm";
}

// ---- GIF export ----------------------------------------------------------
//
// We frame-sample the captured WebM at ~12 fps and write a minimal GIF89a.
// This lives inline because it avoids a CDN dep, and the encoder is small
// enough that you can read it end-to-end below.

async function encodeGif(webm: Blob): Promise<Blob> {
  const url = URL.createObjectURL(webm);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  await new Promise<void>((res) => {
    if (video.readyState >= 2) res();
    else video.addEventListener("loadeddata", () => res(), { once: true });
  });
  const W = Math.min(video.videoWidth, 1280);
  const H = Math.round((W / video.videoWidth) * video.videoHeight);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const fps = 12;
  const dur = video.duration || 5;
  const totalFrames = Math.min(Math.ceil(dur * fps), 600); // cap at 50s @ 12fps
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < totalFrames; i++) {
    const t = (i / fps);
    if (t > dur) break;
    video.currentTime = t;
    await new Promise<void>((r) => video.addEventListener("seeked", () => r(), { once: true }));
    ctx.drawImage(video, 0, 0, W, H);
    frames.push(ctx.getImageData(0, 0, W, H).data.slice());
  }
  URL.revokeObjectURL(url);
  return writeGif89a(frames, W, H, Math.round(100 / fps));
}

/**
 * Minimal GIF89a encoder with global palette quantization (median-cut to 256).
 * It is not the fastest in the world but it is dependency-free and, more
 * importantly, fits in this scaffold so reviewers can see what's happening.
 */
function writeGif89a(frames: Uint8ClampedArray[], w: number, h: number, delayCs: number): Blob {
  const palette = quantize(frames, 256);
  const indexed = frames.map((f) => indexFrame(f, palette));
  const out = new ByteWriter();
  // Header
  out.bytes("GIF89a");
  // Logical screen descriptor
  out.u16(w); out.u16(h);
  out.byte(0xF7); // global color table, 256 entries
  out.byte(0); out.byte(0);
  // Global color table
  for (const c of palette) { out.byte(c[0]); out.byte(c[1]); out.byte(c[2]); }
  // Looping extension (NETSCAPE2.0)
  out.byte(0x21); out.byte(0xFF); out.byte(0x0B);
  out.bytes("NETSCAPE2.0");
  out.byte(0x03); out.byte(0x01); out.u16(0); out.byte(0);
  // Frames
  for (const f of indexed) {
    // Graphic control extension
    out.byte(0x21); out.byte(0xF9); out.byte(0x04);
    out.byte(0x00); out.u16(delayCs); out.byte(0); out.byte(0);
    // Image descriptor
    out.byte(0x2C);
    out.u16(0); out.u16(0); out.u16(w); out.u16(h);
    out.byte(0);
    // LZW minimum code size
    out.byte(8);
    const codes = lzwEncode(f, 8);
    // Sub-blocks (max 255 bytes each)
    for (let i = 0; i < codes.length; i += 255) {
      const slice = codes.slice(i, i + 255);
      out.byte(slice.length);
      for (const b of slice) out.byte(b);
    }
    out.byte(0);
  }
  out.byte(0x3B);
  return new Blob([out.toUint8Array()], { type: "image/gif" });
}

class ByteWriter {
  private buf: number[] = [];
  byte(v: number) { this.buf.push(v & 0xff); }
  u16(v: number) { this.byte(v & 0xff); this.byte((v >> 8) & 0xff); }
  bytes(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  toUint8Array() { return new Uint8Array(this.buf); }
}

/** Median-cut palette quantization across all frames combined. */
function quantize(frames: Uint8ClampedArray[], n: number): [number, number, number][] {
  // Collect a sampled set of pixels — sampling every 8th pixel keeps memory bounded.
  const sample: number[][] = [];
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 32) sample.push([f[i], f[i + 1], f[i + 2]]);
  }
  return medianCut(sample, n);
}

function medianCut(pixels: number[][], n: number): [number, number, number][] {
  const buckets: number[][][] = [pixels];
  while (buckets.length < n) {
    // Find bucket with greatest range, split on its longest axis.
    let bestIdx = 0;
    let bestRange = -1;
    let bestAxis = 0;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length < 2) continue;
      const ranges = [0, 1, 2].map((a) => {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[a] < lo) lo = p[a]; if (p[a] > hi) hi = p[a]; }
        return hi - lo;
      });
      const maxR = Math.max(...ranges);
      if (maxR > bestRange) {
        bestRange = maxR;
        bestIdx = i;
        bestAxis = ranges.indexOf(maxR);
      }
    }
    if (bestRange <= 0) break;
    const b = buckets[bestIdx];
    b.sort((p, q) => p[bestAxis] - q[bestAxis]);
    const mid = b.length >> 1;
    buckets.splice(bestIdx, 1, b.slice(0, mid), b.slice(mid));
  }
  return buckets.map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    const k = Math.max(1, b.length);
    return [Math.round(r / k), Math.round(g / k), Math.round(bl / k)] as [number, number, number];
  }).concat(Array(Math.max(0, n - buckets.length)).fill([0, 0, 0])).slice(0, n);
}

function indexFrame(f: Uint8ClampedArray, palette: [number, number, number][]): Uint8Array {
  const out = new Uint8Array(f.length / 4);
  for (let i = 0, j = 0; i < f.length; i += 4, j++) {
    let best = 0, bestD = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const [pr, pg, pb] = palette[k];
      const d = (pr - f[i]) ** 2 + (pg - f[i + 1]) ** 2 + (pb - f[i + 2]) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    out[j] = best;
  }
  return out;
}

/** Standard GIF LZW encoder. Implementation based on the GIF89a spec. */
function lzwEncode(input: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const dict = new Map<string, number>();
  for (let i = 0; i < clearCode; i++) dict.set(String.fromCharCode(i), i);
  const bits: number[] = [];
  let buffer = 0;
  let bufferLen = 0;
  const out: number[] = [];
  const writeCode = (c: number) => {
    buffer |= c << bufferLen;
    bufferLen += codeSize;
    while (bufferLen >= 8) {
      out.push(buffer & 0xff);
      buffer >>>= 8;
      bufferLen -= 8;
    }
  };
  writeCode(clearCode);
  let prefix = String.fromCharCode(input[0]);
  for (let i = 1; i < input.length; i++) {
    const ch = String.fromCharCode(input[i]);
    const combined = prefix + ch;
    if (dict.has(combined)) {
      prefix = combined;
    } else {
      writeCode(dict.get(prefix)!);
      if (nextCode < 4096) {
        dict.set(combined, nextCode++);
        if (nextCode === (1 << codeSize) + 1 && codeSize < 12) codeSize++;
      }
      prefix = ch;
    }
  }
  writeCode(dict.get(prefix)!);
  writeCode(eoiCode);
  if (bufferLen > 0) out.push(buffer & 0xff);
  return new Uint8Array(out);
}
