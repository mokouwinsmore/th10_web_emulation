// Host direct-touch coordinates are normalized to the iframe viewport, not
// to the canvas. CSS zoom/position and contain letterboxing belong here.
export function contentRect(rect, width = 640, height = 480) {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const scale = Math.min(rect.width / width, rect.height / height);
  return {left: rect.left + (rect.width - width * scale) / 2,
    top: rect.top + (rect.height - height * scale) / 2,
    width: width * scale, height: height * scale, scale};
}
export function touchPoint(x, y, viewport, rect) {
  const content = contentRect(rect);
  if (!content || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const px = (x * viewport.width - content.left) / content.scale;
  const py = (y * viewport.height - content.top) / content.scale;
  return {x: px, y: py, inside: px >= 0 && px <= 640 && py >= 0 && py <= 480};
}
