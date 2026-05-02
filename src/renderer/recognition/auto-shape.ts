// Smart shape recognition. Given a freehand stroke, decide whether the user
// "meant" a primitive (line, arrow, rectangle, ellipse, triangle) and return
// a clean version. We use closed-form geometric features rather than a full
// $1 recognizer because:
//   1. It's fast (microseconds) and stateless — no templates to ship.
//   2. Failures are intuitive: confidence is just "how round vs how rectangular".
//   3. We can tune thresholds without retraining anything.
//
// Inspirations: $1 unistroke recognizer (Wobbrock et al. 2007), Paleo sketch
// recognizer (Paulson & Hammond 2008), and the post-stroke smoothing tricks
// used in Apple Notes / Goodnotes.

import type { Point, Shape, StrokeStyle } from "@shared/types";

const STILL_CLOSED_RATIO = 0.18;   // closed-shape: gap between start/end < this * path length
const LINE_STRAIGHTNESS = 0.96;    // line: chord/path > this
const ARROW_TAIL_RATIO = 0.18;     // an arrow has ≥1 sharp turn near the end
const RECT_CORNERS_TOLERANCE = 0.18; // corners within this fraction of bbox are "rectangular"
const CIRCLE_RADIUS_VARIANCE = 0.22; // points within ±22% of mean radius
const TRIANGLE_CORNERS_TARGET = 3;

export function recognizeStroke(
  points: Point[],
  style: StrokeStyle,
  newId: () => string,
): Shape | null {
  if (points.length < 6) return null;

  const path = pathLength(points);
  if (path < 30) return null; // too small to bother

  const bbox = boundingBox(points);
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  if (Math.max(w, h) < 20) return null;

  const start = points[0];
  const end = points[points.length - 1];
  const chord = dist(start, end);
  const closure = chord / path; // 0..1; smaller means more closed

  // ---- LINE / ARROW (open + straight-ish) ------------------------------
  if (closure > 1 - 0.2) {
    const straightness = chord / path; // same metric, but "high = straight"
    if (straightness >= LINE_STRAIGHTNESS) {
      // Decide line vs arrow by the angular history near the end.
      const tail = arrowTailScore(points);
      if (tail > ARROW_TAIL_RATIO) {
        return { id: newId(), kind: "arrow", from: start, to: end, style };
      }
      return { id: newId(), kind: "line", from: start, to: end, style };
    }
  }

  // ---- Closed shapes -----------------------------------------------------
  if (closure < STILL_CLOSED_RATIO) {
    // CIRCLE/ELLIPSE: low radius variance from the centroid.
    const c = centroid(points);
    const radii = points.map((p) => dist(p, c));
    const meanR = radii.reduce((a, b) => a + b, 0) / radii.length;
    const variance = radii.reduce((a, r) => a + Math.abs(r - meanR) / meanR, 0) / radii.length;
    if (variance < CIRCLE_RADIUS_VARIANCE) {
      return {
        id: newId(),
        kind: "ellipse",
        cx: (bbox.minX + bbox.maxX) / 2,
        cy: (bbox.minY + bbox.maxY) / 2,
        rx: w / 2,
        ry: h / 2,
        style,
      };
    }
    // RECTANGLE: detect 3+ corners that hug the bounding box corners.
    if (looksRectangular(points, bbox)) {
      return { id: newId(), kind: "rect", x: bbox.minX, y: bbox.minY, w, h, style };
    }
    // TRIANGLE: 3 sharp corners. We keep the recognized stroke as a polyline
    // by constructing a closed line via three line shapes — but for a small
    // scaffold we just bail and let the freehand stroke stand.
    const corners = countCorners(points, 0.55);
    if (corners === TRIANGLE_CORNERS_TARGET) {
      // Approximate as a generic "stroke" with snapped vertices.
      const snapped = snapCorners(points, 3);
      return { id: newId(), kind: "stroke", points: snapped, style, smoothed: true };
    }
  }

  return null;
}

// ---- Geometry helpers ----------------------------------------------------

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function pathLength(pts: Point[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}
function centroid(pts: Point[]): Point {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}
function boundingBox(pts: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Heuristic: a stroke is rectangular if at least 3 of its 4 bbox corners are
 *  approached within a small distance (relative to the bbox diagonal). */
function looksRectangular(points: Point[], bbox: ReturnType<typeof boundingBox>): boolean {
  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  const tol = diag * RECT_CORNERS_TOLERANCE;
  const corners = [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY },
  ];
  let hits = 0;
  for (const c of corners) {
    let nearest = Infinity;
    for (const p of points) {
      const d = dist(p, c);
      if (d < nearest) nearest = d;
    }
    if (nearest < tol) hits++;
  }
  return hits >= 3;
}

/** Cheap corner counter — counts angular turns above `threshold` radians. */
function countCorners(points: Point[], threshold: number): number {
  let count = 0;
  for (let i = 4; i < points.length - 4; i++) {
    const a = points[i - 4];
    const b = points[i];
    const c = points[i + 4];
    const angle = angleBetween(a, b, c);
    if (Math.abs(Math.PI - angle) > threshold) count++;
  }
  // Cluster nearby detections.
  return Math.max(0, Math.round(count / 6));
}
function angleBetween(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (mag === 0) return Math.PI;
  const cos = Math.max(-1, Math.min(1, dot / mag));
  return Math.acos(cos);
}

/** A simple "arrowhead" detector: did the stroke double back at the end? */
function arrowTailScore(points: Point[]): number {
  const n = points.length;
  if (n < 12) return 0;
  // Direction of the main shaft (first 60% of points)
  const shaft = points[Math.floor(n * 0.6)];
  const start = points[0];
  const dx = shaft.x - start.x;
  const dy = shaft.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  // For each tail point, measure perpendicular distance from the shaft line.
  let maxPerp = 0;
  for (let i = Math.floor(n * 0.7); i < n; i++) {
    const p = points[i];
    const t = ((p.x - start.x) * dx + (p.y - start.y) * dy) / (len * len);
    const px = start.x + t * dx;
    const py = start.y + t * dy;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d > maxPerp) maxPerp = d;
  }
  return maxPerp / len;
}

/** Find `k` highest-curvature points and return a simplified polyline. */
function snapCorners(points: Point[], k: number): Point[] {
  const scores: { i: number; s: number }[] = [];
  for (let i = 5; i < points.length - 5; i++) {
    const a = points[i - 5];
    const b = points[i];
    const c = points[i + 5];
    scores.push({ i, s: Math.PI - angleBetween(a, b, c) });
  }
  scores.sort((a, b) => b.s - a.s);
  const corners = scores.slice(0, k).map((x) => x.i).sort((a, b) => a - b);
  const out: Point[] = [points[0]];
  for (const i of corners) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}
