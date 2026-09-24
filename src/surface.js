export function panelBounds(panel) {
  return panel.bounds;
}

export function slotRect(slot) {
  return {
    minU: slot.u - slot.width / 2,
    maxU: slot.u + slot.width / 2,
    minV: slot.v - slot.height / 2,
    maxV: slot.v + slot.height / 2,
  };
}

/** Axis-aligned union of slot UV rectangles (multi-select allowed region). */
export function unionSlotBounds(slots) {
  if (!slots.length) return { minU: 0, maxU: 0, minV: 0, maxV: 0 };
  return {
    minU: Math.min(...slots.map((slot) => slot.u - slot.width / 2)),
    maxU: Math.max(...slots.map((slot) => slot.u + slot.width / 2)),
    minV: Math.min(...slots.map((slot) => slot.v - slot.height / 2)),
    maxV: Math.max(...slots.map((slot) => slot.v + slot.height / 2)),
  };
}

/** Closed UV loops for the chosen placement region (panel mask or each selected slot). */
export function placementRegionLoops(panel, slots, { entirePanel = false } = {}) {
  if (entirePanel || !slots.length) {
    return [panelMaskPoints(panel)];
  }
  return slots.map((slot) => {
    const rect = slotRect(slot);
    return [
      [rect.minU, rect.minV],
      [rect.maxU, rect.minV],
      [rect.maxU, rect.maxV],
      [rect.minU, rect.maxV],
    ];
  });
}

export function isEntirePanelSelected(panel, selectedIds) {
  return Boolean(panel?.slots?.length) && selectedIds.length >= panel.slots.length;
}

export function panelMaskPoints(panel) {
  return panel.outline;
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

/**
 * Clamp UV to selected slot region ∩ panel mask.
 * Entire-panel selection uses the full mask; otherwise the AABB of selected slots.
 */
export function clampToPlacementRegion(panel, slots, u, v, { entirePanel = false } = {}) {
  if (entirePanel || !slots.length) return clampToPanelMask(panel, u, v);
  const rect = unionSlotBounds(slots);
  const cu = Math.min(rect.maxU, Math.max(rect.minU, u));
  const cv = Math.min(rect.maxV, Math.max(rect.minV, v));
  return clampToPanelMask(panel, cu, cv);
}

export function pointInPlacementRegion(panel, slots, u, v, { entirePanel = false, pad = 0 } = {}) {
  if (entirePanel || !slots.length) {
    const bounds = panelBounds(panel);
    return (
      u >= bounds.minU - pad
      && u <= bounds.maxU + pad
      && v >= bounds.minV - pad
      && v <= bounds.maxV + pad
    );
  }
  const rect = unionSlotBounds(slots);
  return (
    u >= rect.minU - pad
    && u <= rect.maxU + pad
    && v >= rect.minV - pad
    && v <= rect.maxV + pad
  );
}
