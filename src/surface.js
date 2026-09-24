export function panelBounds(panel) {
  return {
    minU: Math.min(...panel.slots.map((slot) => slot.u - slot.width / 2)),
    maxU: Math.max(...panel.slots.map((slot) => slot.u + slot.width / 2)),
    minV: Math.min(...panel.slots.map((slot) => slot.v - slot.height / 2)),
    maxV: Math.max(...panel.slots.map((slot) => slot.v + slot.height / 2)),
  };
}

export function panelMaskPoints(panel) {
  const bounds = panelBounds(panel);
  return panel.mask.map(([x, y]) => [
    bounds.minU + x * (bounds.maxU - bounds.minU),
    bounds.minV + y * (bounds.maxV - bounds.minV),
  ]);
}

export function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function clampToPanelMask(panel, u, v) {
  const polygon = panelMaskPoints(panel);
  if (pointInPolygon([u, v], polygon)) return [u, v];
  let closest = polygon[0];
  let closestDistance = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)));
    const point = [ax + t * dx, ay + t * dy];
    const distance = (u - point[0]) ** 2 + (v - point[1]) ** 2;
    if (distance < closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  }
  return closest;
}
