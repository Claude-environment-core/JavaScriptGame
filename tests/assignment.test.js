import assert from "node:assert/strict";
import test from "node:test";

import {
  assignSlots,
  countReassignments,
  solveAssignment,
} from "../src/sim/formation/assignment.js";

/** Exhaustive optimum, for checking the solver on small problems. */
function bruteForce(cost) {
  const n = cost.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  let best = Infinity;

  const permute = (remaining, chosen, total) => {
    if (remaining.length === 0) {
      best = Math.min(best, total);
      return;
    }

    for (const column of remaining) {
      permute(
        remaining.filter((c) => c !== column),
        [...chosen, column],
        total + cost[chosen.length][column],
      );
    }
  };

  permute(indices, [], 0);
  return best;
}

function totalCost(cost, assignment) {
  return assignment.reduce((sum, column, row) => sum + cost[row][column], 0);
}

test("the solver finds the optimal assignment", () => {
  const cases = [
    [[1]],
    [
      [4, 1],
      [2, 9],
    ],
    [
      [7, 3, 5],
      [2, 8, 1],
      [6, 4, 9],
    ],
    [
      [12, 7, 9, 7],
      [8, 9, 6, 6],
      [7, 17, 12, 14],
      [15, 12, 6, 6],
    ],
  ];

  for (const cost of cases) {
    const assignment = solveAssignment(cost);
    assert.equal(new Set(assignment).size, cost.length, "every slot is used once");
    assert.equal(totalCost(cost, assignment), bruteForce(cost));
  }
});

test("the solver matches brute force on random problems", () => {
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let trial = 0; trial < 30; trial += 1) {
    const n = 2 + (trial % 5);
    const cost = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => Math.round(random() * 100)),
    );

    assert.equal(totalCost(cost, solveAssignment(cost)), bruteForce(cost));
  }
});

test("an empty problem has an empty solution", () => {
  assert.deepEqual(solveAssignment([]), []);
});

test("agents take the nearest slots, not the ones matching their index", () => {
  const positions = [
    { x: 10, y: 0 },
    { x: 0, y: 0 },
  ];
  const slots = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];

  assert.deepEqual(assignSlots(positions, slots, null, 0), [1, 0]);
});

test("the switching cost holds an assignment through a near-tie", () => {
  const slots = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  const positions = [
    { x: 0.51, y: 0 },
    { x: 0.49, y: 0 },
  ];

  // Swapping is marginally cheaper, but not by enough to be worth the churn.
  assert.deepEqual(assignSlots(positions, slots, [0, 1], 0.6), [0, 1]);
  assert.deepEqual(assignSlots(positions, slots, null, 0), [1, 0]);
});

test("a clearly better assignment still wins", () => {
  const slots = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  const positions = [
    { x: 9, y: 0 },
    { x: 1, y: 0 },
  ];

  assert.deepEqual(assignSlots(positions, slots, [0, 1], 0.6), [1, 0]);
});

test("reassignments are counted against the previous assignment", () => {
  assert.equal(countReassignments(null, [0, 1]), 0);
  assert.equal(countReassignments([0, 1], [0, 1]), 0);
  assert.equal(countReassignments([0, 1], [1, 0]), 2);
});
