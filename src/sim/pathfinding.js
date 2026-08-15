import { PriorityQueue } from "./priorityQueue.js";

/** Uniform cost of stepping to a 4-neighbour. */
export const STEP_COST = 1.0;

/** Euclidean heuristic. */
export function heuristic(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function cellKey(x, y) {
  return `${x},${y}`;
}

/**
 * A* over a {@link GridMap} using 4-neighbour expansion.
 *
 * Invalid input — a start or goal that is out of bounds or non-walkable — is
 * rejected up front and returns `null`, the same value used for "no route".
 *
 * @returns {Array<{x: number, y: number}>|null} grid cells from start to goal.
 */
export function findPath(map, start, goal) {
  if (!map) {
    return null;
  }

  const startCell = { x: Math.floor(start.x), y: Math.floor(start.y) };
  const goalCell = { x: Math.floor(goal.x), y: Math.floor(goal.y) };

  if (!map.isWalkable(startCell.x, startCell.y) || !map.isWalkable(goalCell.x, goalCell.y)) {
    return null;
  }

  const startKey = cellKey(startCell.x, startCell.y);
  const goalKey = cellKey(goalCell.x, goalCell.y);

  if (startKey === goalKey) {
    return [startCell];
  }

  const open = new PriorityQueue();
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const closed = new Set();

  open.enqueue(startKey, startCell, heuristic(startCell, goalCell));

  while (!open.isEmpty()) {
    const current = open.dequeue();
    const currentKey = cellKey(current.x, current.y);

    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, current, startKey);
    }

    closed.add(currentKey);

    for (const neighbor of map.neighbors(current.x, current.y)) {
      if (!map.isWalkable(neighbor.x, neighbor.y)) {
        continue;
      }

      const neighborKey = cellKey(neighbor.x, neighbor.y);
      if (closed.has(neighborKey)) {
        continue;
      }

      const tentativeG = gScore.get(currentKey) + STEP_COST;
      const knownG = gScore.get(neighborKey);

      if (knownG !== undefined && tentativeG >= knownG) {
        continue;
      }

      cameFrom.set(neighborKey, current);
      gScore.set(neighborKey, tentativeG);
      open.enqueue(neighborKey, neighbor, tentativeG + heuristic(neighbor, goalCell));
    }
  }

  return null;
}

/** Walks `cameFrom` back from the goal, then reverses into start -> goal order. */
function reconstructPath(cameFrom, goalCell, startKey) {
  const path = [goalCell];
  let current = goalCell;
  let currentKey = cellKey(current.x, current.y);

  while (currentKey !== startKey) {
    current = cameFrom.get(currentKey);
    if (!current) {
      return null;
    }

    path.push(current);
    currentKey = cellKey(current.x, current.y);
  }

  path.reverse();
  return path;
}

/**
 * Converts a grid path into world-space waypoints at cell centres.
 */
export function pathToWaypoints(map, path) {
  if (!path) {
    return [];
  }

  return path.map((cell) => map.gridToWorldCenter(cell.x, cell.y));
}
