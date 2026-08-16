/**
 * Which agent holds which slot.
 *
 * Assignment minimises total squared distance, so the formation forms up by the
 * shortest total travel rather than by array index. A switching cost is added to
 * any pairing that differs from last tick's: without it, two agents equidistant
 * from two slots trade places every tick and neither arrives.
 */

import { sqrMagnitude, subtract } from "../vec2.js";

/**
 * Hungarian algorithm (O(n³), potentials formulation) for a square cost matrix.
 *
 * @param {number[][]} cost cost[i][j] of assigning row i to column j
 * @returns {number[]} column chosen for each row
 */
export function solveAssignment(cost) {
  const n = cost.length;
  if (n === 0) {
    return [];
  }

  const potentialRow = new Array(n + 1).fill(0);
  const potentialColumn = new Array(n + 1).fill(0);
  const columnRow = new Array(n + 1).fill(0);
  const path = new Array(n + 1).fill(0);

  for (let row = 1; row <= n; row += 1) {
    columnRow[0] = row;
    let column = 0;
    const minimum = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);

    do {
      used[column] = true;
      const currentRow = columnRow[column];
      let delta = Infinity;
      let nextColumn = 0;

      for (let j = 1; j <= n; j += 1) {
        if (used[j]) {
          continue;
        }

        const reduced =
          cost[currentRow - 1][j - 1] - potentialRow[currentRow] - potentialColumn[j];

        if (reduced < minimum[j]) {
          minimum[j] = reduced;
          path[j] = column;
        }

        if (minimum[j] < delta) {
          delta = minimum[j];
          nextColumn = j;
        }
      }

      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          potentialRow[columnRow[j]] += delta;
          potentialColumn[j] -= delta;
        } else {
          minimum[j] -= delta;
        }
      }

      column = nextColumn;
    } while (columnRow[column] !== 0);

    do {
      const previous = path[column];
      columnRow[column] = columnRow[previous];
      column = previous;
    } while (column !== 0);
  }

  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= n; j += 1) {
    if (columnRow[j] > 0) {
      assignment[columnRow[j] - 1] = j - 1;
    }
  }

  return assignment;
}

/**
 * Assigns agents to slots, preferring to keep last tick's pairing.
 *
 * @param {Array<{x: number, y: number}>} positions
 * @param {Array<{x: number, y: number}>} slots
 * @param {number[]|null} previous last tick's assignment, or null
 * @param {number} switchingCost penalty for changing a pairing
 */
export function assignSlots(positions, slots, previous, switchingCost) {
  const n = positions.length;
  const cost = [];

  for (let i = 0; i < n; i += 1) {
    const row = new Array(n);

    for (let j = 0; j < n; j += 1) {
      const travel = sqrMagnitude(subtract(slots[j], positions[i]));
      const keeps = previous && previous[i] === j;
      row[j] = travel + (keeps ? 0 : switchingCost);
    }

    cost.push(row);
  }

  return solveAssignment(cost);
}

/** Number of agents whose slot changed between two assignments. */
export function countReassignments(previous, next) {
  if (!previous) {
    return 0;
  }

  let changes = 0;
  for (let i = 0; i < next.length; i += 1) {
    if (previous[i] !== next[i]) {
      changes += 1;
    }
  }

  return changes;
}
