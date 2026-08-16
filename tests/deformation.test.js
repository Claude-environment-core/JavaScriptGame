import assert from "node:assert/strict";
import test from "node:test";

import {
  FormationDeformation,
  FormationMode,
  getLattice,
} from "../src/sim/formation/deformation.js";
import { makeFormationParams, personalSpace } from "../src/sim/formation/params.js";
import {
  FormationType,
  getExtents,
  getMinimumGap,
  getOffsets,
} from "../src/sim/formation/shape.js";
import { AnchorTrail } from "../src/sim/formation/spine.js";
import { distance } from "../src/sim/vec2.js";

const params = makeFormationParams();

/** A straight spine, so slot placement reduces to rigid rotation. */
function straightSpine(anchor = { x: 10, y: 10 }) {
  return new AnchorTrail(anchor, 20);
}

function slotGap(slots) {
  let smallest = Infinity;

  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      smallest = Math.min(smallest, distance(slots[i], slots[j]));
    }
  }

  return smallest;
}

test("every shape produces one offset per agent", () => {
  for (const type of Object.values(FormationType)) {
    for (const count of [0, 1, 5, 9]) {
      assert.equal(getOffsets(type, count).length, count);
    }
  }
});

test("the wedge trails the leader in widening rows", () => {
  const offsets = getOffsets(FormationType.Wedge, 5);

  assert.deepEqual(offsets[0], { x: 0, y: 0 });
  assert.ok(offsets[1].x < 0 && offsets[2].x > 0);
  assert.equal(offsets[1].y, offsets[2].y);
  assert.ok(offsets[3].y < offsets[1].y);
});

test("the column has no width and the line has no depth", () => {
  assert.equal(getExtents(getOffsets(FormationType.Column, 5)).halfWidth, 0);
  assert.equal(getExtents(getOffsets(FormationType.Line, 5)).depth, 0);
});

test("the narrowing floor is derived from body size, not declared", () => {
  const wide = getLattice(FormationType.Wedge, 5, makeFormationParams({ bodyRadius: 0.1 }));
  const bulky = getLattice(FormationType.Wedge, 5, makeFormationParams({ bodyRadius: 0.45 }));

  assert.ok(wide.lateralFloor < bulky.lateralFloor, "bigger bodies cannot squeeze as far");
  assert.ok(wide.lateralFloor > 0 && bulky.lateralFloor <= 1);
});

test("no deformation within the floor puts two slots inside personal space", () => {
  // The invariant the whole pattern rests on: a valid formation never triggers
  // the constraint layer, so slot tracking and collision avoidance never fight.
  for (const type of Object.values(FormationType)) {
    for (const bodyRadius of [0.15, 0.25, 0.35]) {
      const shapeParams = makeFormationParams({ bodyRadius });
      const lattice = getLattice(type, 5, shapeParams);
      const deformation = new FormationDeformation(type, 5, shapeParams);
      const minimum = personalSpace(shapeParams);

      for (let scale = 1; scale >= lattice.lateralFloor; scale -= 0.05) {
        deformation.scaleX = scale;
        deformation.scaleY = Math.min(Math.max(1 / scale, 1), lattice.maxLongitudinal);

        const gap = slotGap(deformation.slots(straightSpine(), { x: 0, y: 1 }));
        assert.ok(
          gap >= minimum - 1e-9,
          `${type} at bodyRadius ${bodyRadius}, scale ${scale.toFixed(2)}: gap ${gap.toFixed(3)} < ${minimum}`,
        );
      }
    }
  }
});

test("narrowing lengthens the formation, preserving its area", () => {
  const deformation = new FormationDeformation(FormationType.Wedge, 5, params);

  // Room for a little over half the nominal width: enough to squeeze into,
  // not so little that the shape has to degrade.
  for (let i = 0; i < 20; i += 1) {
    deformation.update(0.1, 1.0);
  }

  assert.equal(deformation.mode, FormationMode.Squeeze);
  assert.ok(deformation.scaleX < 1);
  assert.ok(Math.abs(deformation.scaleX * deformation.scaleY - 1) < 1e-9);
});

test("a wide corridor leaves the formation open", () => {
  const deformation = new FormationDeformation(FormationType.Wedge, 5, params);

  for (let i = 0; i < 40; i += 1) {
    deformation.update(0.1, 6);
  }

  assert.equal(deformation.mode, FormationMode.Open);
  assert.equal(deformation.scaleX, 1);
});

test("a corridor too narrow to squeeze into degrades the shape to a file", () => {
  const deformation = new FormationDeformation(FormationType.Wedge, 5, params);

  for (let i = 0; i < 40; i += 1) {
    deformation.update(0.1, 0.1);
  }

  assert.equal(deformation.mode, FormationMode.File);
  assert.equal(deformation.active.type, FormationType.Column);
  assert.equal(deformation.halfWidth, 0);
});

test("leaving file mode needs more room than entering it did", () => {
  const deformation = new FormationDeformation(FormationType.Wedge, 5, params);
  const floor = deformation.base.lateralFloor;
  const nominalHalfWidth = deformation.base.halfWidth * params.spacing;

  for (let i = 0; i < 40; i += 1) {
    deformation.update(0.1, 0.1);
  }
  assert.equal(deformation.mode, FormationMode.File);

  // Just above the floor: not enough to come back out.
  const justAbove = (floor + 0.05) * nominalHalfWidth;
  for (let i = 0; i < 40; i += 1) {
    deformation.update(0.1, justAbove);
  }
  assert.equal(deformation.mode, FormationMode.File, "hysteresis holds the shape");

  const wellAbove = (floor + params.modeHysteresis + 0.1) * nominalHalfWidth;
  for (let i = 0; i < 40; i += 1) {
    deformation.update(0.1, wellAbove);
  }
  assert.notEqual(deformation.mode, FormationMode.File);
});

test("the formation contracts faster than it expands", () => {
  const contracting = new FormationDeformation(FormationType.Wedge, 5, params);
  const expanding = new FormationDeformation(FormationType.Wedge, 5, params);

  contracting.smoothedDemand = 1;
  contracting.update(0.1, 0);

  expanding.scaleX = 0.4;
  expanding.smoothedDemand = 0.4;
  expanding.update(0.1, 10);

  assert.ok(
    1 - contracting.scaleX > expanding.scaleX - 0.4,
    "narrowing early is cheap; widening early puts an agent into a wall",
  );
});

test("slot spacing scales with the lattice's nominal gap", () => {
  const offsets = getOffsets(FormationType.Line, 4);
  assert.equal(getMinimumGap(offsets), 1);
});
