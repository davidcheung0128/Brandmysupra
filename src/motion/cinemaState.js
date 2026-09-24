import { PANELS } from "../slots.js";

/** Shared cinema refs — R3F reads these in useFrame without React rerenders. */
export const cinemaRefs = {
  progress: { current: 0 },
  smoothed: { current: 0 },
  phase: { current: "presentation" },
  reducedMotion: { current: false },
};

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Scroll chapters after the brand open, in auction-panel order.
 * Each chapter is an edit stop: camera holds on the panel so the user can place a logo.
 */
export const PANEL_TOUR = [
  {
    key: "hood",
    index: "01",
    label: "Hood",
    line: "Choose coverage, then place your logo on the nose.",
    camera: [6.4, 3.5, 2.4],
    look: [1.35, 1.15, 0],
    yaw: 0.08,
  },
  {
    key: "driverDoor",
    index: "02",
    label: "Driver door",
    line: "Rotate in — configure the driver-side panel.",
    camera: [1.2, 1.55, 7.4],
    look: [0.1, 0.85, 1.05],
    yaw: 0.02,
  },
  {
    key: "passengerDoor",
    index: "03",
    label: "Passenger door",
    line: "Mirror side — pick slots and drop artwork.",
    camera: [1.2, 1.55, -7.4],
    look: [0.1, 0.85, -1.05],
    yaw: -0.02,
  },
  {
    key: "roof",
    index: "04",
    label: "Roof",
    line: "Top view for roof placements.",
    camera: [0.2, 8.6, 0.4],
    look: [-0.2, 1.55, 0],
    yaw: 0,
  },
  {
    key: "driverQuarter",
    index: "05",
    label: "Driver quarter",
    line: "Rear flank — set coverage and place.",
    camera: [-4.8, 1.7, 5.6],
    look: [-1.9, 0.9, 1.0],
    yaw: 0.35,
  },
  {
    key: "passengerQuarter",
    index: "06",
    label: "Passenger quarter",
    line: "Opposite flank for another mark.",
    camera: [-4.8, 1.7, -5.6],
    look: [-1.9, 0.9, -1.0],
    yaw: -0.35,
  },
  {
    key: "frontBumper",
    index: "07",
    label: "Front bumper",
    line: "Low front bumper real estate.",
    camera: [8.2, 1.15, 0.15],
    look: [2.8, 0.55, 0],
    yaw: 0,
  },
  {
    key: "rearWing",
    index: "08",
    label: "Rear deck",
    line: "Finish on the rear deck, then free-orbit studio.",
    camera: [-7.6, 2.4, 0.2],
    look: [-2.2, 1.15, 0],
    yaw: Math.PI * 0.92,
  },
];

const BRAND_END = 0.036; // keep intro→hood ~same absolute scroll as before
const TOUR_END = 0.9;
/** Hold most of each panel segment for editing before blending to the next. */
const PANEL_HOLD = 0.8;

export function sceneWeights(progress) {
  const p = clamp01(progress);
  return {
    brand: clamp01(1 - p / BRAND_END),
    panelTour: clamp01((p - BRAND_END) / (TOUR_END - BRAND_END)),
    morph: clamp01((p - TOUR_END) / 0.06),
    lock: clamp01((p - 0.96) / 0.04),
  };
}

export function phaseFromProgress(progress) {
  if (progress < BRAND_END) return "presentation";
  if (progress < TOUR_END) return "editing";
  if (progress < 0.96) return "handoff";
  return "configurator";
}

/** Resolve the active panel chapter and blend toward the next camera. */
export function panelTourFromProgress(progress) {
  const p = clamp01(progress);
  if (p <= BRAND_END) {
    return {
      mode: "brand",
      panelIndex: -1,
      blend: 0,
      current: null,
      next: PANEL_TOUR[0],
      panelKey: null,
    };
  }

  if (p >= TOUR_END) {
    const last = PANEL_TOUR[PANEL_TOUR.length - 1];
    return {
      mode: "studio",
      panelIndex: PANEL_TOUR.length - 1,
      blend: 1,
      current: last,
      next: last,
      panelKey: last.key,
    };
  }

  const local = (p - BRAND_END) / (TOUR_END - BRAND_END);
  const scaled = local * PANEL_TOUR.length;
  const index = Math.min(PANEL_TOUR.length - 1, Math.floor(scaled));
  const nextIndex = Math.min(PANEL_TOUR.length - 1, index + 1);
  const segment = scaled - index;
  const blend = segment <= PANEL_HOLD ? 0 : easeInOutCubic((segment - PANEL_HOLD) / (1 - PANEL_HOLD));
  const current = PANEL_TOUR[index];

  return {
    mode: "panel",
    panelIndex: index,
    blend,
    current,
    next: PANEL_TOUR[nextIndex],
    panelKey: current.key,
  };
}

export function highlightSlotsForPanel(panelKey) {
  if (!panelKey || !PANELS[panelKey]) return [];
  return PANELS[panelKey].slots.map((slot) => slot.id);
}

/** Scroll progress at the hold center of a panel chapter. */
export function progressForPanel(panelKey) {
  const index = PANEL_TOUR.findIndex((entry) => entry.key === panelKey);
  if (index < 0) return TOUR_END;
  const local = (index + PANEL_HOLD * 0.45) / PANEL_TOUR.length;
  return BRAND_END + local * (TOUR_END - BRAND_END);
}

export function lerpVectors(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
