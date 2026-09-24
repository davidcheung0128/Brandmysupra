import assert from "node:assert/strict";
import { isCompanyEmail, nextBidForSlots } from "../src/domain.js";
import { ALL_SLOTS, INITIAL_BIDS, PANELS, SLOT_MAP } from "../src/slots.js";
import { clampToPanelMask, panelMaskPoints, pointInPolygon } from "../src/surface.js";

assert.equal(ALL_SLOTS.length, 20);
assert.equal(isCompanyEmail("hello@company.com"), true);
assert.equal(isCompanyEmail("hello@gmail.com"), false);
assert.equal(isCompanyEmail("not-an-email"), false);
assert.equal(nextBidForSlots(["hood-1", "hood-2"], SLOT_MAP, INITIAL_BIDS), 5750);
const doorMask = panelMaskPoints(PANELS.driverDoor);
assert.equal(pointInPolygon([0, 0], doorMask), true);
assert.notDeepEqual(clampToPanelMask(PANELS.driverDoor, 99, 99), [99, 99]);
console.log("Prototype checks passed");
