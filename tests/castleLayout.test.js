import assert from "node:assert/strict";
import test from "node:test";

import { MIN_CASTLE_SIZE, generateCastle } from "../src/castle/generate.js";
import { CastleTile, oppositeSide, rectContains } from "../src/castle/layout.js";
import { WardId } from "../src/castle/vectors.js";
import { WardType } from "../src/castle/wards.js";

const SIZE = 64;

function build(seed = 0) {
  return generateCastle({ width: SIZE, height: SIZE, seed });
}

test("a castle is reproducible from its seed", () => {
  const first = build(3);
  const second = build(3);
  const other = build(4);

  assert.deepEqual(first.castle.map.toRows(), second.castle.map.toRows());
  assert.deepEqual(first.castle.toJSON(), second.castle.toJSON());
  assert.notDeepEqual(first.castle.map.toRows(), other.castle.map.toRows());
});

test("a castle needs room to be a castle", () => {
  assert.throws(() => generateCastle({ width: MIN_CASTLE_SIZE - 1, height: 64 }), RangeError);
});

test("the outer border is walled", () => {
  const { castle } = build();

  for (let x = 0; x < castle.map.width; x += 1) {
    assert.ok(!castle.map.isWalkable(x, 0));
    assert.ok(!castle.map.isWalkable(x, castle.map.height - 1));
  }

  for (let y = 0; y < castle.map.height; y += 1) {
    assert.ok(!castle.map.isWalkable(0, y));
    assert.ok(!castle.map.isWalkable(castle.map.width - 1, y));
  }
});

test("the curtain walls are continuous apart from their chokepoints", () => {
  for (let seed = 0; seed < 8; seed += 1) {
    const { castle, layout } = build(seed);
    const crossings = new Set(
      castle.edges.flatMap((edge) => edge.tiles.map((tile) => `${tile.x},${tile.y}`)),
    );

    for (const ring of [layout.rings.outer, layout.rings.inner, layout.rings.keep]) {
      for (let y = ring.minY; y <= ring.maxY; y += 1) {
        for (let x = ring.minX; x <= ring.maxX; x += 1) {
          const onPerimeter = x === ring.minX || x === ring.maxX || y === ring.minY || y === ring.maxY;

          if (onPerimeter && castle.map.isWalkable(x, y)) {
            assert.ok(
              crossings.has(`${x},${y}`),
              `seed ${seed}: a gap at ${x},${y} that is not a chokepoint`,
            );
          }
        }
      }
    }
  }
});

test("no straight run from the field to the keep: the gates are offset", () => {
  for (let seed = 0; seed < 12; seed += 1) {
    const { layout } = build(seed);

    assert.notEqual(
      layout.sides.innerGate,
      layout.sides.outerGate,
      `seed ${seed}: the inner gate faces the same way as the outer gate`,
    );
    assert.equal(layout.sides.keepDoor, oppositeSide(layout.sides.innerGate));
  }
});

test("the gatehouse flanks the main gate with towers", () => {
  const { castle, layout } = build(1);
  const gate = layout.gates.outer;
  const neighbours = [];

  for (const tile of gate.tiles) {
    for (const offset of [-2, -1, 1, 2]) {
      neighbours.push(
        layout.sides.outerGate === "north" || layout.sides.outerGate === "south"
          ? castle.map.get(tile.x + offset, tile.y)
          : castle.map.get(tile.x, tile.y + offset),
      );
    }
  }

  assert.ok(neighbours.includes(CastleTile.Tower), "the gate is set in a gatehouse");
});

test("every ward is one walkable piece, but for the drain", () => {
  for (let seed = 0; seed < 8; seed += 1) {
    const { castle } = build(seed);

    for (const ward of castle.wardList) {
      const components = walkableComponents(castle, ward.id);
      assert.ok(components.length > 0, `seed ${seed}: ${ward.type} has no floor`);

      // The bailey a drain crosses is allowed to be in two pieces, because the
      // drain is a covered channel walled off from it. Nothing else is.
      const [largest, ...rest] = components.sort((a, b) => b.length - a.length);
      assert.ok(largest.length > 0);

      for (const tile of rest.flat()) {
        assert.equal(
          castle.landmarks.features.get(`${tile.x},${tile.y}`)?.type,
          "sewer",
          `seed ${seed}: ${ward.type} is cut off at ${tile.x},${tile.y}`,
        );
      }
    }
  }
});

/** The walkable tiles of a ward, grouped into connected pieces. */
function walkableComponents(castle, wardId) {
  const tiles = [...castle.walkableTilesIn(wardId)];
  const remaining = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
  const components = [];

  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    if (!remaining.has(key)) {
      continue;
    }

    remaining.delete(key);
    const queue = [tile];
    const component = [];

    while (queue.length > 0) {
      const cell = queue.pop();
      component.push(cell);

      for (const neighbor of castle.map.neighbors(cell.x, cell.y)) {
        const neighborKey = `${neighbor.x},${neighbor.y}`;

        if (remaining.has(neighborKey)) {
          remaining.delete(neighborKey);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  return components;
}

test("the wards nest, outermost to innermost", () => {
  const { castle, layout } = build(2);
  const depths = castle.wardList.map((ward) => ward.depth);

  assert.deepEqual(depths, [0, 1, 2, 3]);
  assert.equal(castle.wardOfType(WardType.Keep).id, WardId.Keep);

  assert.ok(rectContains(layout.rings.outer, layout.rings.inner.minX, layout.rings.inner.minY));
  assert.ok(rectContains(layout.rings.inner, layout.rings.keep.minX, layout.rings.keep.minY));
});

test("the princess is held in the keep, away from its door", () => {
  for (let seed = 0; seed < 6; seed += 1) {
    const { castle, layout } = build(seed);
    const ward = castle.wardAt(castle.princess.x, castle.princess.y);

    assert.equal(ward.type, WardType.Keep, `seed ${seed}`);
    assert.ok(castle.map.isWalkable(castle.princess.x, castle.princess.y));

    const door = layout.gates.keep.inside;
    assert.ok(
      Math.hypot(castle.princess.x - door.x, castle.princess.y - door.y) > 2,
      `seed ${seed}: she is standing in the doorway`,
    );
  }
});

test("the rally point is open ground a party can stand on", () => {
  for (let seed = 0; seed < 6; seed += 1) {
    const { castle } = build(seed);
    const rally = castle.landmarks.rally;

    assert.ok(castle.map.isWalkable(rally.x, rally.y), `seed ${seed}`);
    assert.equal(castle.wardAt(rally.x, rally.y).type, WardType.Approach);
  }
});

test("watchtowers hold the open ground in view", () => {
  const { castle } = build(0);
  const towers = castle.landmarks.towers;

  assert.equal(towers.length, 4, "one tower per corner of the curtain");

  for (const tower of towers) {
    assert.ok(castle.map.isWalkable(tower.post.x, tower.post.y), "the watch has somewhere to stand");
    assert.equal(castle.wardAt(tower.post.x, tower.post.y).type, WardType.Approach);
  }
});
