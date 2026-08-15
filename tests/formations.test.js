import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FORMATION_SPACING,
  FormationType,
  getFormationOffsets,
  getFormationSlots,
} from "../src/sim/formations.js";
import { distance, localToWorld, rightOf } from "../src/sim/vec2.js";

const spacing = DEFAULT_FORMATION_SPACING;

test("every formation produces one offset per agent", () => {
  for (const formation of Object.values(FormationType)) {
    for (const count of [0, 1, 5, 9]) {
      assert.equal(getFormationOffsets(formation, count, spacing).length, count);
    }
  }
});

test("the wedge trails the leader in widening rows", () => {
  const offsets = getFormationOffsets(FormationType.Wedge, 5, spacing);

  assert.deepEqual(offsets[0], { x: 0, y: 0 });
  assert.ok(offsets[1].x < 0 && offsets[2].x > 0, "row 1 spreads either side");
  assert.equal(offsets[1].y, offsets[2].y);
  assert.ok(offsets[3].y < offsets[1].y, "row 2 sits further back");
});

test("the line spreads laterally around the anchor", () => {
  const offsets = getFormationOffsets(FormationType.Line, 4, spacing);

  assert.ok(offsets.every((offset) => offset.y === 0));
  const sum = offsets.reduce((total, offset) => total + offset.x, 0);
  assert.ok(Math.abs(sum) < 1e-9, "the line is centred");
  assert.ok(Math.abs(offsets[1].x - offsets[0].x - spacing) < 1e-9);
});

test("the column trails in a single file", () => {
  const offsets = getFormationOffsets(FormationType.Column, 4, spacing);

  assert.ok(offsets.every((offset) => offset.x === 0));
  offsets.forEach((offset, index) => {
    assert.ok(Math.abs(offset.y + index * spacing) < 1e-9);
  });
});

test("the circle spaces agents evenly on a ring", () => {
  const count = 6;
  const offsets = getFormationOffsets(FormationType.Circle, count, spacing);
  const radii = offsets.map((offset) => Math.hypot(offset.x, offset.y));

  for (const radius of radii) {
    assert.ok(Math.abs(radius - radii[0]) < 1e-9, "every agent sits on the same ring");
  }

  const first = Math.atan2(offsets[0].y, offsets[0].x);
  const second = Math.atan2(offsets[1].y, offsets[1].x);
  assert.ok(Math.abs(second - first - (2 * Math.PI) / count) < 1e-9);
});

test("the spread fills a near-square block", () => {
  const offsets = getFormationOffsets(FormationType.Spread, 9, spacing);
  const columns = new Set(offsets.map((offset) => offset.x.toFixed(6)));
  const rows = new Set(offsets.map((offset) => offset.y.toFixed(6)));

  assert.equal(columns.size, 3);
  assert.equal(rows.size, 3);
});

test("slots rotate with the squad's facing direction", () => {
  const anchor = { x: 10, y: 10 };
  const forward = { x: 0, y: 1 };
  const slots = getFormationSlots(FormationType.Line, 3, anchor, forward, spacing);

  // Facing +y, the line spreads along +x.
  assert.ok(Math.abs(slots[0].y - anchor.y) < 1e-9);
  assert.ok(slots[0].x < anchor.x && slots[2].x > anchor.x);

  const rotated = getFormationSlots(FormationType.Line, 3, anchor, { x: 1, y: 0 }, spacing);

  // Facing +x, the same line spreads along -y, and slot distances are unchanged.
  assert.ok(Math.abs(rotated[0].x - anchor.x) < 1e-9);
  assert.ok(
    Math.abs(distance(slots[0], anchor) - distance(rotated[0], anchor)) < 1e-9,
    "rotation preserves slot distance",
  );
});

test("local-to-world uses the right-hand perpendicular of forward", () => {
  assert.deepEqual(rightOf({ x: 0, y: 1 }), { x: 1, y: -0 });

  const world = localToWorld({ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 2, y: 3 });
  assert.ok(Math.abs(world.x - 3) < 1e-9);
  assert.ok(Math.abs(world.y - 4) < 1e-9);
});
