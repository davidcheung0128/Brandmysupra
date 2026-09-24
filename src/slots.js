/**
 * Bid sections, fitted to public/models/supra.optimized.glb (car-group space: +x nose, +y up,
 * +z driver side). Each panel is a flat frame (origin/uAxis/vAxis/normal) that is projected onto
 * the paint mesh. `bounds` and `outline` are absolute (u, v) metres in that frame; slots tile the
 * bounds exactly, so bid areas never leave gaps or overlap. A logo is clipped to the selected
 * slots ∩ outline (see sections.js).
 */
const tile = (panel, label, [minU, maxU, minV, maxV], [cols, rows], current) => {
  const width = (maxU - minU) / cols;
  const height = (maxV - minV) / rows;
  return Array.from({ length: cols * rows }, (_, index) => ({
    id: `${panel}-${index + 1}`,
    panel,
    label: `${label} ${index + 1}`,
    u: minU + width * (index % cols + 0.5),
    v: minV + height * (Math.floor(index / cols) + 0.5),
    width,
    height,
    current: current + index * 250,
    increment: 250,
  }));
};

const makePanel = (key, { label, bounds, grid, current, outline, ...frame }) => ({
  label,
  ...frame,
  bounds: { minU: bounds[0], maxU: bounds[1], minV: bounds[2], maxV: bounds[3] },
  outline,
  slots: tile(key, label, bounds, grid, current),
});

/** Passenger-side twin of a driver-side panel; u still grows toward screen-right. */
const mirror = (key, label, current, def) => makePanel(key, {
  ...def,
  label,
  current,
  origin: [def.origin[0], def.origin[1], -def.origin[2]],
  uAxis: [-1, 0, 0],
  normal: [0, 0, -1],
  bounds: [-def.bounds[1], -def.bounds[0], def.bounds[2], def.bounds[3]],
  outline: def.outline.map(([u, v]) => [-u, v]),
});

const driverDoor = {
  label: "Driver door",
  origin: [0, 0, 1.28],
  uAxis: [1, 0, 0],
  vAxis: [0, 1, 0],
  normal: [0, 0, 1],
  bounds: [-1, 0.68, 0.3, 1.25],
  grid: [3, 1],
  current: 4000,
  outline: [[-0.98, 0.32], [0.66, 0.32], [0.68, 1.05], [0.6, 1.24], [-0.9, 1.24], [-1, 1.05]],
};

const driverQuarter = {
  label: "Driver quarter",
  origin: [0, 0, 1.22],
  uAxis: [1, 0, 0],
  vAxis: [0, 1, 0],
  normal: [0, 0, 1],
  bounds: [-3, -1.2, 0.55, 1.5],
  grid: [2, 1],
  current: 1750,
  // Follows the rear wheel arch so slots never cover the wheel opening.
  outline: [
    [-2.98, 0.55], [-2.42, 0.55], [-2.36, 0.75], [-2.22, 0.92], [-2, 1.03], [-1.84, 1.05], [-1.62, 1],
    [-1.44, 0.85], [-1.26, 0.62], [-1.2, 0.55], [-1.2, 1.5], [-2.3, 1.42], [-2.98, 1.36],
  ],
};

export const PANELS = {
  hood: makePanel("hood", {
    label: "Hood",
    origin: [0, 1.15, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    normal: [0, 1, 0],
    bounds: [0.85, 3.05, -1.1, 1.1],
    grid: [2, 2],
    current: 2500,
    outline: [[0.85, -1.1], [2.4, -1.1], [2.98, -0.66], [3.08, -0.3], [3.08, 0.3], [2.98, 0.66], [2.4, 1.1], [0.85, 1.1]],
  }),
  driverDoor: makePanel("driverDoor", driverDoor),
  passengerDoor: mirror("passengerDoor", "Passenger door", 3500, driverDoor),
  roof: makePanel("roof", {
    label: "Roof",
    origin: [0, 1.72, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    normal: [0, 1, 0],
    bounds: [-1.45, -0.05, -0.88, 0.88],
    grid: [2, 1],
    current: 2000,
    outline: [[-1.41, -0.88], [-0.09, -0.88], [-0.05, -0.75], [-0.05, 0.75], [-0.09, 0.88], [-1.41, 0.88], [-1.45, 0.75], [-1.45, -0.75]],
  }),
  driverQuarter: makePanel("driverQuarter", driverQuarter),
  passengerQuarter: mirror("passengerQuarter", "Passenger quarter", 1750, driverQuarter),
  frontBumper: makePanel("frontBumper", {
    label: "Front bumper",
    origin: [2.9, 0, 0],
    uAxis: [0, 0, -1],
    vAxis: [0, 1, 0],
    normal: [1, 0, 0],
    bounds: [-1.2, 1.2, 0.25, 0.95],
    grid: [2, 1],
    current: 1500,
    outline: [[-0.75, 0.28], [0.75, 0.28], [1.1, 0.45], [1.2, 0.8], [0.8, 0.95], [-0.8, 0.95], [-1.2, 0.8], [-1.1, 0.45]],
  }),
  rearWing: makePanel("rearWing", {
    label: "Rear deck",
    origin: [0, 1.2, 0],
    uAxis: [0, 0, 1],
    vAxis: [1, 0, 0],
    normal: [0, 1, 0],
    bounds: [-1.22, 1.22, -3.05, -2.45],
    grid: [2, 1],
    current: 3000,
    outline: [[-0.8, -3.08], [0.8, -3.08], [1.05, -2.95], [1.18, -2.75], [1.22, -2.45], [-1.22, -2.45], [-1.18, -2.75], [-1.05, -2.95]],
  }),
};

export const ALL_SLOTS = Object.values(PANELS).flatMap((panel) => panel.slots);
export const SLOT_MAP = Object.fromEntries(ALL_SLOTS.map((slot) => [slot.id, slot]));
export const INITIAL_BIDS = Object.fromEntries(ALL_SLOTS.map((slot) => [slot.id, slot.current]));
