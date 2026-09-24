import assert from "node:assert/strict";
import { isCompanyEmail, nextBidForSlots } from "../src/domain.js";
import { ALL_SLOTS, INITIAL_BIDS, PANELS, SLOT_MAP } from "../src/slots.js";
import { clampToPanelMask, panelMaskPoints, pointInPolygon } from "../src/surface.js";
import { coverageRatio, createPlacement, orientationFromNormal, updatePlacement } from "../src/placement.js";
import { alphaConvexHull, hullHandlePoints, logoWorldSize } from "../src/logo.js";

assert.equal(ALL_SLOTS.length, 20);
assert.equal(isCompanyEmail("hello@company.com"), true);
assert.equal(isCompanyEmail("hello@gmail.com"), false);
assert.equal(isCompanyEmail("not-an-email"), false);
assert.equal(nextBidForSlots(["hood-1", "hood-2"], SLOT_MAP, INITIAL_BIDS), 5750);
const doorMask = panelMaskPoints(PANELS.driverDoor);
assert.equal(pointInPolygon([0, 0], doorMask), true);
assert.notDeepEqual(clampToPanelMask(PANELS.driverDoor, 99, 99), [99, 99]);

const placement = createPlacement({
  panelMesh: "hood",
  surfacePoint: [1, 1.2, 0],
  surfaceNormal: [0, 1, 0],
  uvCenter: [0.4, 0.6],
  selectedSlotIds: ["hood-1", "hood-2"],
});
assert.equal(placement.panelMesh, "hood");
assert.deepEqual(updatePlacement(placement, { scale: 0.5 }).scale, 0.5);
assert.ok(orientationFromNormal([0, 1, 0], 0.2));
assert.ok(coverageRatio(["hood-1", "hood-2"], PANELS.hood) > coverageRatio(["hood-1"], PANELS.hood));

const canvas = { width: 4, height: 4, getContext() {
  return {
    getImageData() {
      const data = new Uint8ClampedArray(4 * 4 * 4);
      for (let i = 0; i < data.length; i += 4) data[i + 3] = i === 20 || i === 24 || i === 36 ? 255 : 0;
      return { data, width: 4, height: 4 };
    },
  };
} };
const hull = alphaConvexHull(canvas, { step: 1 });
assert.ok(hull.length >= 3);
assert.equal(hullHandlePoints(hull).length, 4);
assert.deepEqual(logoWorldSize(2, 1, 1, 1), { width: 1, height: 0.5 });

console.log("Prototype checks passed");
