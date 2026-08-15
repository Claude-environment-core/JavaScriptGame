import { GridMap, TILE_BLOCKED, TILE_WALKABLE } from "./gridMap.js";
import { DeterministicRandom } from "./rng.js";

/** Generation seed. Deterministic by contract. */
export const DEFAULT_SEED = 0;

/** A partition smaller than this on either axis is never split again. */
export const MIN_PARTITION_SIZE = 10;

/** Distance a split line keeps from its partition's boundaries. */
export const SPLIT_MARGIN = 5;

export const DEFAULT_ROOM_BUDGET = 12;

/**
 * A node of the binary partition tree.
 */
class Partition {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.left = null;
    this.right = null;
    this.splitAxis = null;
    this.splitPosition = null;
  }

  get isLeaf() {
    return this.left === null && this.right === null;
  }

  get center() {
    return {
      x: Math.floor(this.x + this.width / 2),
      y: Math.floor(this.y + this.height / 2),
    };
  }
}

/**
 * Deterministic binary-partition world generation.
 *
 *  1. Every tile starts walkable.
 *  2. Space is recursively split; a split is written as a full blocked line.
 *  3. Outer border walls are drawn.
 *  4. Corridors are carved by walking the partition tree, clearing the cells
 *     they traverse.
 *
 * Random call order and traversal order are parity critical: the same seed must
 * always produce the same map.
 */
export function generateWorld({
  width = 64,
  height = 64,
  seed = DEFAULT_SEED,
  roomBudget = DEFAULT_ROOM_BUDGET,
} = {}) {
  const map = new GridMap(width, height, TILE_WALKABLE);
  const random = new DeterministicRandom(seed);
  const root = new Partition(0, 0, width, height);
  const budget = { remaining: roomBudget };

  splitPartition(map, random, root, budget);
  drawBorder(map);
  carveConnections(map, root);

  return { map, tree: root, seed };
}

/**
 * Recursively splits a partition, writing each split as a blocked line.
 */
function splitPartition(map, random, node, budget) {
  if (budget.remaining <= 0) {
    return;
  }

  if (node.width < MIN_PARTITION_SIZE || node.height < MIN_PARTITION_SIZE) {
    return;
  }

  // Split axis follows the larger extent.
  const splitVertically = node.width >= node.height;
  const extent = splitVertically ? node.width : node.height;

  const minSplit = SPLIT_MARGIN;
  const maxSplit = extent - SPLIT_MARGIN;

  if (maxSplit <= minSplit) {
    return;
  }

  const offset = random.nextInt(minSplit, maxSplit);
  budget.remaining -= 1;

  if (splitVertically) {
    const splitX = node.x + offset;
    node.splitAxis = "x";
    node.splitPosition = splitX;

    for (let y = node.y; y < node.y + node.height; y += 1) {
      map.set(splitX, y, TILE_BLOCKED);
    }

    node.left = new Partition(node.x, node.y, offset, node.height);
    node.right = new Partition(splitX + 1, node.y, node.width - offset - 1, node.height);
  } else {
    const splitY = node.y + offset;
    node.splitAxis = "y";
    node.splitPosition = splitY;

    for (let x = node.x; x < node.x + node.width; x += 1) {
      map.set(x, splitY, TILE_BLOCKED);
    }

    node.left = new Partition(node.x, node.y, node.width, offset);
    node.right = new Partition(node.x, splitY + 1, node.width, node.height - offset - 1);
  }

  splitPartition(map, random, node.left, budget);
  splitPartition(map, random, node.right, budget);
}

function drawBorder(map) {
  for (let x = 0; x < map.width; x += 1) {
    map.set(x, 0, TILE_BLOCKED);
    map.set(x, map.height - 1, TILE_BLOCKED);
  }

  for (let y = 0; y < map.height; y += 1) {
    map.set(0, y, TILE_BLOCKED);
    map.set(map.width - 1, y, TILE_BLOCKED);
  }
}

/**
 * Post-order traversal that links each pair of sibling partitions with an
 * L-shaped corridor, clearing every traversed cell.
 */
function carveConnections(map, node) {
  if (!node || node.isLeaf) {
    return;
  }

  carveConnections(map, node.left);
  carveConnections(map, node.right);

  carveCorridor(map, node.left.center, node.right.center);
}

function carveCorridor(map, from, to) {
  carveHorizontal(map, from.x, to.x, from.y);
  carveVertical(map, from.y, to.y, to.x);
}

function carveHorizontal(map, fromX, toX, y) {
  const start = Math.min(fromX, toX);
  const end = Math.max(fromX, toX);

  for (let x = start; x <= end; x += 1) {
    clearInterior(map, x, y);
  }
}

function carveVertical(map, fromY, toY, x) {
  const start = Math.min(fromY, toY);
  const end = Math.max(fromY, toY);

  for (let y = start; y <= end; y += 1) {
    clearInterior(map, x, y);
  }
}

/** Corridors never punch holes in the outer border. */
function clearInterior(map, x, y) {
  if (x <= 0 || y <= 0 || x >= map.width - 1 || y >= map.height - 1) {
    return;
  }

  map.set(x, y, TILE_WALKABLE);
}

/** Collects the leaf partitions of a tree, left to right. */
export function collectRooms(node, rooms = []) {
  if (!node) {
    return rooms;
  }

  if (node.isLeaf) {
    rooms.push(node);
    return rooms;
  }

  collectRooms(node.left, rooms);
  collectRooms(node.right, rooms);
  return rooms;
}
