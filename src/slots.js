const makeSlots = (panel, label, count, start, step, size, current) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${panel}-${index + 1}`,
    panel,
    label: `${label} ${index + 1}`,
    u: start + step * index,
    v: 0,
    width: size[0],
    height: size[1],
    current: current + index * 250,
    increment: 250,
  }));

export const PANELS = {
  hood: {
    label: "Hood",
    mask: [[0.08, 0.05], [0.92, 0.05], [1, 0.3], [0.94, 0.95], [0.06, 0.95], [0, 0.3]],
    origin: [1.48, 1.22, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    rotation: [-Math.PI / 2, 0, 0],
    slots: [
      { id: "hood-1", panel: "hood", label: "Hood 1", u: -0.5, v: -0.42, width: 0.88, height: 0.68, current: 2500, increment: 250 },
      { id: "hood-2", panel: "hood", label: "Hood 2", u: 0.5, v: -0.42, width: 0.88, height: 0.68, current: 2750, increment: 250 },
      { id: "hood-3", panel: "hood", label: "Hood 3", u: -0.5, v: 0.42, width: 0.88, height: 0.68, current: 3000, increment: 250 },
      { id: "hood-4", panel: "hood", label: "Hood 4", u: 0.5, v: 0.42, width: 0.88, height: 0.68, current: 3250, increment: 250 },
    ],
  },
  driverDoor: {
    label: "Driver door",
    mask: [[0.04, 0.18], [0.12, 0.02], [0.9, 0.06], [0.98, 0.22], [0.91, 0.94], [0.08, 0.98]],
    origin: [0, 0.78, 1.28],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    rotation: [0, 0, 0],
    slots: makeSlots("driverDoor", "Driver door", 3, -0.78, 0.78, [0.68, 0.54], 4000),
  },
  passengerDoor: {
    label: "Passenger door",
    mask: [[0.04, 0.18], [0.12, 0.02], [0.9, 0.06], [0.98, 0.22], [0.91, 0.94], [0.08, 0.98]],
    origin: [0, 0.78, -1.28],
    uAxis: [-1, 0, 0],
    vAxis: [0, 1, 0],
    rotation: [0, Math.PI, 0],
    slots: makeSlots("passengerDoor", "Passenger door", 3, -0.78, 0.78, [0.68, 0.54], 3500),
  },
  roof: {
    label: "Roof",
    mask: [[0.12, 0.04], [0.88, 0.04], [1, 0.5], [0.88, 0.96], [0.12, 0.96], [0, 0.5]],
    origin: [-0.3, 1.72, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    rotation: [-Math.PI / 2, 0, 0],
    slots: makeSlots("roof", "Roof", 2, -0.42, 0.84, [0.72, 0.86], 2000),
  },
  driverQuarter: {
    label: "Driver quarter",
    mask: [[0.05, 0.18], [0.2, 0.04], [0.96, 0.12], [0.9, 0.96], [0.08, 0.9]],
    origin: [-2.05, 0.84, 1.21],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    rotation: [0, 0, 0],
    slots: makeSlots("driverQuarter", "Driver quarter", 2, -0.33, 0.66, [0.56, 0.5], 1750),
  },
  passengerQuarter: {
    label: "Passenger quarter",
    mask: [[0.05, 0.18], [0.2, 0.04], [0.96, 0.12], [0.9, 0.96], [0.08, 0.9]],
    origin: [-2.05, 0.84, -1.21],
    uAxis: [-1, 0, 0],
    vAxis: [0, 1, 0],
    rotation: [0, Math.PI, 0],
    slots: makeSlots("passengerQuarter", "Passenger quarter", 2, -0.33, 0.66, [0.56, 0.5], 1750),
  },
  frontBumper: {
    label: "Front bumper",
    mask: [[0.08, 0.08], [0.92, 0.08], [1, 0.35], [0.9, 0.92], [0.1, 0.92], [0, 0.35]],
    origin: [3.11, 0.58, 0],
    uAxis: [0, 0, 1],
    vAxis: [0, 1, 0],
    rotation: [0, Math.PI / 2, 0],
    slots: makeSlots("frontBumper", "Front bumper", 2, -0.48, 0.96, [0.82, 0.3], 1500),
  },
  rearWing: {
    label: "Rear deck",
    mask: [[0.06, 0.08], [0.94, 0.08], [1, 0.5], [0.92, 0.92], [0.08, 0.92], [0, 0.5]],
    origin: [-2.4, 1.18, 0],
    uAxis: [0, 0, 1],
    vAxis: [1, 0, 0],
    rotation: [-Math.PI / 2, 0, Math.PI / 2],
    slots: makeSlots("rearWing", "Rear deck", 2, -0.48, 0.96, [0.82, 0.46], 3000),
  },
};

export const ALL_SLOTS = Object.values(PANELS).flatMap((panel) => panel.slots);
export const SLOT_MAP = Object.fromEntries(ALL_SLOTS.map((slot) => [slot.id, slot]));
export const INITIAL_BIDS = Object.fromEntries(ALL_SLOTS.map((slot) => [slot.id, slot.current]));
