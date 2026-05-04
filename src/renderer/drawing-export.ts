import type { DrawingSnapshot, Point, Shape, StrokeStyle } from "@shared/types";

export function snapshotToSvg(snapshot: DrawingSnapshot): string {
  const { width, height } = snapshot.bounds;
  const content = snapshot.shapes.map(shapeToSvg).filter(Boolean).join("\n  ");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(width)}" height="${formatNumber(height)}" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}" fill="none">`,
    content ? `  ${content}` : "",
    "</svg>",
  ].filter(Boolean).join("\n");
}

function shapeToSvg(shape: Shape): string {
  switch (shape.kind) {
    case "stroke":
      return strokeToSvg(shape.points, shape.style);
    case "line":
      return `<line ${lineAttrs(shape.from, shape.to)} ${strokeAttrs(shape.style)} />`;
    case "arrow":
      return arrowToSvg(shape.from, shape.to, shape.style);
    case "rect":
      return `<rect x="${formatNumber(shape.x)}" y="${formatNumber(shape.y)}" width="${formatNumber(shape.w)}" height="${formatNumber(shape.h)}" ${paintAttrs(shape.style)} />`;
    case "ellipse":
      return `<ellipse cx="${formatNumber(shape.cx)}" cy="${formatNumber(shape.cy)}" rx="${formatNumber(Math.abs(shape.rx))}" ry="${formatNumber(Math.abs(shape.ry))}" ${paintAttrs(shape.style)} />`;
    case "text":
      return textToSvg(shape);
    case "blur":
      return blurToSvg(shape);
  }
}

function strokeToSvg(points: Point[], style: StrokeStyle): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `<circle cx="${formatNumber(points[0].x)}" cy="${formatNumber(points[0].y)}" r="${formatNumber(style.width / 2)}" fill="${escapeXml(style.color)}" opacity="${formatNumber(style.opacity)}" />`;
  }

  const commands = [`M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const midpointX = (point.x + next.x) / 2;
    const midpointY = (point.y + next.y) / 2;
    commands.push(
      `Q ${formatNumber(point.x)} ${formatNumber(point.y)} ${formatNumber(midpointX)} ${formatNumber(midpointY)}`,
    );
  }
  const last = points[points.length - 1];
  commands.push(`L ${formatNumber(last.x)} ${formatNumber(last.y)}`);
  return `<path d="${commands.join(" ")}" ${strokeAttrs(style)} />`;
}

function arrowToSvg(from: Point, to: Point, style: StrokeStyle): string {
  const head = Math.max(10, style.width * 4);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const path = [
    `M ${formatNumber(to.x)} ${formatNumber(to.y)}`,
    `L ${formatNumber(to.x - head * Math.cos(angle - Math.PI / 7))} ${formatNumber(to.y - head * Math.sin(angle - Math.PI / 7))}`,
    `L ${formatNumber(to.x - head * 0.7 * Math.cos(angle))} ${formatNumber(to.y - head * 0.7 * Math.sin(angle))}`,
    `L ${formatNumber(to.x - head * Math.cos(angle + Math.PI / 7))} ${formatNumber(to.y - head * Math.sin(angle + Math.PI / 7))}`,
    "Z",
  ].join(" ");

  return [
    `<line ${lineAttrs(from, to)} ${strokeAttrs(style)} />`,
    `<path d="${path}" fill="${escapeXml(style.color)}" opacity="${formatNumber(style.opacity)}" />`,
  ].join("");
}

function textToSvg(shape: Extract<Shape, { kind: "text" }>): string {
  const lines = shape.text.split("\n");
  const lineHeight = shape.size * 1.25;
  const tspans = lines.map((line, index) => {
    const dy = index === 0 ? "0" : formatNumber(lineHeight);
    const text = line.length === 0 ? " " : escapeXml(line);
    return `<tspan x="${formatNumber(shape.x)}" dy="${dy}">${text}</tspan>`;
  }).join("");

  return `<text x="${formatNumber(shape.x)}" y="${formatNumber(shape.y)}" fill="${escapeXml(shape.style.color)}" font-family="${escapeXml(shape.font)}" font-size="${formatNumber(shape.size)}" opacity="${formatNumber(shape.style.opacity)}" dominant-baseline="text-before-edge" xml:space="preserve">${tspans}</text>`;
}

function blurToSvg(shape: Extract<Shape, { kind: "blur" }>): string {
  return `<rect x="${formatNumber(shape.x)}" y="${formatNumber(shape.y)}" width="${formatNumber(shape.w)}" height="${formatNumber(shape.h)}" fill="#FFFFFF" fill-opacity="0.14" stroke="#FFFFFF" stroke-opacity="0.34" stroke-dasharray="6 4" opacity="0.9" />`;
}

function lineAttrs(from: Point, to: Point): string {
  return `x1="${formatNumber(from.x)}" y1="${formatNumber(from.y)}" x2="${formatNumber(to.x)}" y2="${formatNumber(to.y)}"`;
}

function paintAttrs(style: StrokeStyle): string {
  return [
    `stroke="${escapeXml(style.color)}"`,
    `stroke-width="${formatNumber(style.width)}"`,
    `stroke-linecap="round"`,
    `stroke-linejoin="round"`,
    `opacity="${formatNumber(style.opacity)}"`,
    style.fill ? `fill="${escapeXml(style.fill)}"` : `fill="none"`,
    style.dash && style.dash.length > 0 ? `stroke-dasharray="${style.dash.map(formatNumber).join(" ")}"` : "",
  ].filter(Boolean).join(" ");
}

function strokeAttrs(style: StrokeStyle): string {
  return [
    `fill="none"`,
    `stroke="${escapeXml(style.color)}"`,
    `stroke-width="${formatNumber(style.width)}"`,
    `stroke-linecap="round"`,
    `stroke-linejoin="round"`,
    `opacity="${formatNumber(style.opacity)}"`,
    style.dash && style.dash.length > 0 ? `stroke-dasharray="${style.dash.map(formatNumber).join(" ")}"` : "",
  ].filter(Boolean).join(" ");
}

function formatNumber(value: number): string {
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return fixed.replace(/\.0+$|\.(\d*[1-9])0+$/u, ".$1");
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}