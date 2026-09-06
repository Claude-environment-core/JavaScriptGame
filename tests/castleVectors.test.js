import assert from "node:assert/strict";
import test from "node:test";

import { generateCastle } from "../src/castle/generate.js";
import { CastleTile } from "../src/castle/layout.js";
import { MAX_ACTIVE_VECTORS, MIN_ACTIVE_VECTORS, WardId } from "../src/castle/vectors.js";
import { JustificationTag, TraversalType, VectorType } from "../src/castle/wards.js";

const SIZE = 80;
const SEEDS = 24;

function build(seed = 0) {
  return generateCastle({ width: SIZE, height: SIZE, seed });
}

test("every castle offers a handful of candidate ways in, and lives only some", () => {
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const { castle } = build(seed);
    const candidates = castle.candidateVectors();
    const active = castle.activeVectors();

    assert.ok(candidates.length >= 3 && candidates.length <= 5, `seed ${seed}: ${candidates.length}`);
    assert.ok(
      active.length >= Math.min(MIN_ACTIVE_VECTORS, candidates.length - 1),
      `seed ${seed}: only ${active.length} live`,
    );
    assert.ok(active.length <= MAX_ACTIVE_VECTORS, `seed ${seed}: ${active.length} live`);
    assert.ok(active.length < candidates.length, `seed ${seed}: every weak point is live`);
  }
});

test("which weak points are live varies from seed to seed", () => {
  const shapes = new Set();

  for (let seed = 0; seed < SEEDS; seed += 1) {
    const { castle } = build(seed);
    shapes.add(
      castle
        .activeVectors()
        .map((edge) => edge.vectorType)
        .sort()
        .join(","),
    );
  }

  assert.ok(shapes.size >= 5, `only ${shapes.size} different sets of weak points in ${SEEDS} seeds`);
});

test("every vector kind turns up across a run of seeds", () => {
  const seen = new Set();

  for (let seed = 0; seed < 40; seed += 1) {
    for (const edge of build(seed).castle.activeVectors()) {
      seen.add(edge.vectorType);
    }
  }

  for (const kind of [
    VectorType.Postern,
    VectorType.Kitchen,
    VectorType.Sewer,
    VectorType.Breach,
    VectorType.Bribe,
  ]) {
    assert.ok(seen.has(kind), `${kind} never appeared`);
  }
});

test("every vector carries the profile the level needs to reason about it", () => {
  const { castle } = build(2);

  for (const edge of castle.candidateVectors()) {
    assert.ok(edge.location && Number.isInteger(edge.location.x), `${edge.id} has no location`);
    assert.ok(edge.mouth, `${edge.id} has no mouth`);
    assert.ok(typeof edge.garrisonDensity === "number", `${edge.id} has no garrison density`);
    assert.ok(edge.alertSensitivity > 0 && edge.alertSensitivity <= 1, `${edge.id} sensitivity`);
    assert.ok(Object.values(TraversalType).includes(edge.traversalType), `${edge.id} traversal`);
    assert.ok(Object.values(JustificationTag).includes(edge.justificationTag), `${edge.id} tag`);
    assert.ok(edge.cost.time > 0 && edge.note.length > 0, `${edge.id} cost profile`);
    assert.ok(edge.fromWard !== edge.toWard, `${edge.id} goes nowhere`);
  }
});

test("a vector that is not live leaves no way through", () => {
  for (let seed = 0; seed < 12; seed += 1) {
    const { castle } = build(seed);

    for (const edge of castle.candidateVectors()) {
      if (edge.isActive) {
        continue;
      }

      // The wall it would have pierced is still a wall. (A candidate's tiles
      // can include open ground either side of it, so what is asserted is that
      // the crossing is blocked somewhere, not that every tile is masonry.)
      assert.ok(
        edge.tiles.some((tile) => !castle.map.isWalkable(tile.x, tile.y)),
        `seed ${seed}: inactive ${edge.vectorType} left a hole at ${edge.location.x},${edge.location.y}`,
      );

      // Nothing on the map is attributed to it. (Another, live vector may own
      // a tile this candidate would have shared — that tile is that vector's.)
      for (const tile of edge.tiles) {
        assert.notEqual(
          castle.landmarks.features.get(`${tile.x},${tile.y}`)?.edgeId,
          edge.id,
          `seed ${seed}: inactive ${edge.vectorType} was marked on the map`,
        );
      }
    }
  }
});

test("a breach is masonry until it is brought down, and a bribed door is shut", () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const { castle } = build(seed);

    for (const edge of castle.activeVectors()) {
      if (edge.vectorType === VectorType.Breach) {
        assert.equal(edge.traversalType, TraversalType.Combat);
        assert.ok(!edge.isOpen, `seed ${seed}: the breach starts open`);
        assert.ok(edge.tiles.every((tile) => castle.map.get(tile.x, tile.y) === CastleTile.WeakMasonry));
      }

      if (edge.vectorType === VectorType.Bribe) {
        assert.equal(edge.traversalType, TraversalType.Puzzle);
        assert.ok(!edge.isOpen, `seed ${seed}: the door starts open`);
        assert.ok(edge.tiles.every((tile) => !castle.map.isWalkable(tile.x, tile.y)));
      }
    }
  }
});

test("the drain bypasses the outer bailey and is walled along its length", () => {
  let checked = 0;

  for (let seed = 0; seed < 30 && checked < 3; seed += 1) {
    const { castle } = build(seed);
    const sewer = castle.activeVectors().find((edge) => edge.vectorType === VectorType.Sewer);

    if (!sewer) {
      continue;
    }

    checked += 1;
    assert.equal(sewer.fromWard, WardId.Approach);
    assert.equal(sewer.toWard, WardId.InnerBailey, "the drain skips a ward");
    assert.ok(sewer.cost.time > 1.5, "the crawl costs time");
    assert.ok(sewer.tiles.every((tile) => castle.map.isWalkable(tile.x, tile.y)));

    // Walled on both sides: the channel is covered, not a trench across the bailey.
    const horizontal = sewer.tiles.every((tile) => tile.y === sewer.tiles[0].y);
    const flanks = sewer.tiles.flatMap((tile) =>
      horizontal
        ? [castle.map.isWalkable(tile.x, tile.y - 1), castle.map.isWalkable(tile.x, tile.y + 1)]
        : [castle.map.isWalkable(tile.x - 1, tile.y), castle.map.isWalkable(tile.x + 1, tile.y)],
    );

    const open = flanks.filter(Boolean).length;
    assert.ok(open <= 2, `the drain opens into the bailey at ${open} points`);
  }

  assert.ok(checked > 0, "no seed in the sample produced a drain");
});

test("the main gate is always a way in, whatever the weak points do", () => {
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const { castle, report } = build(seed);
    const gates = castle.edges.filter((edge) => !edge.isWeakPoint);

    assert.equal(gates.length, 3, `seed ${seed}`);
    assert.ok(
      gates.every((gate) => gate.isPassable),
      `seed ${seed}: a gate starts shut`,
    );
    assert.ok(report.isSolvable, `seed ${seed}: no route from the field to the princess`);
    assert.ok(report.stormPathSteps > 40, `seed ${seed}: the storm path is suspiciously short`);
  }
});

test("the ward graph routes from the field to the keep through the gates", () => {
  const { castle } = build(5);
  const chain = castle.wardPath(WardId.Approach, WardId.Keep);

  assert.ok(chain.length >= 2, "the keep is not reached in one step");
  assert.equal(chain[chain.length - 1].toWard, WardId.Keep);
  assert.ok(chain.every((edge) => edge.isPassable));
});

test("a shut chokepoint takes its route out of the graph", () => {
  const { castle } = build(5);
  const keepGate = castle.edges.find((edge) => edge.toWard === WardId.Keep);

  keepGate.isOpen = false;

  assert.equal(castle.wardPath(WardId.Approach, WardId.Keep), null);
  assert.ok(castle.wardPath(WardId.Approach, WardId.Keep, { openOnly: false }).length >= 2);
});
