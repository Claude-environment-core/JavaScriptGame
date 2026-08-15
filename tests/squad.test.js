/**
 * Fixtures A and B: chokepoint traversal end to end.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createAgents } from "../src/sim/agent.js";
import { findPath } from "../src/sim/pathfinding.js";
import { FormationType } from "../src/sim/formations.js";
import {
  DEFAULT_TICK_BEHAVIOR_ORDER,
  SquadPlan,
  SquadState,
  createSquadController,
} from "../src/sim/squad.js";
import { DEFAULT_STEERING_PARAMS } from "../src/sim/steering.js";
import { distance } from "../src/sim/vec2.js";
import { buildFixtureA, buildFixtureB, buildOpenMap } from "./fixtures.js";

function runFixture(fixture) {
  const agents = createAgents(fixture.startPositions);
  const controller = createSquadController({
    agents,
    map: fixture.map,
    goal: fixture.goal,
  });

  assert.ok(controller, "expected a route to exist");

  let ticks = 0;
  for (let i = 0; i < fixture.maxTicks; i += 1) {
    controller.tick(fixture.dt);
    ticks = i + 1;

    if (controller.hasArrived(fixture.arrivalRadius)) {
      break;
    }
  }

  return { agents, controller, ticks };
}

test("fixture A: five agents funnel through a single chokepoint", () => {
  const fixture = buildFixtureA();
  const path = findPath(fixture.map, { x: 1, y: 1 }, { x: 10, y: 10 });

  assert.ok(path, "a path exists");
  assert.ok(
    path.some((cell) => cell.x === fixture.opening.x && cell.y === fixture.opening.y),
    "the path traverses the opening",
  );

  for (const cell of path) {
    assert.ok(fixture.map.isWalkable(cell.x, cell.y), "every waypoint is walkable");
  }

  const { agents, ticks } = runFixture(fixture);
  assert.ok(ticks < fixture.maxTicks, `expected arrival within ${fixture.maxTicks} ticks`);

  for (const agent of agents) {
    const gap = distance(agent.position, fixture.goal);
    assert.ok(gap <= fixture.arrivalRadius, `agent ${agent.id} is ${gap.toFixed(2)} from the goal`);
  }
});

test("fixture B: five agents cross two sequential chokepoints", () => {
  const fixture = buildFixtureB();
  const path = findPath(fixture.map, { x: 1, y: 3 }, { x: 11, y: 12 });

  assert.ok(path, "a path exists");

  for (const doorway of fixture.doorways) {
    assert.ok(
      path.some((cell) => cell.x === doorway.x && cell.y === doorway.y),
      `the path traverses the doorway at (${doorway.x}, ${doorway.y})`,
    );
  }

  for (const cell of path) {
    assert.ok(fixture.map.isWalkable(cell.x, cell.y), "every waypoint is walkable");
  }

  const { agents, ticks } = runFixture(fixture);
  assert.ok(ticks < fixture.maxTicks, `expected arrival within ${fixture.maxTicks} ticks`);

  for (const agent of agents) {
    const gap = distance(agent.position, fixture.goal);
    assert.ok(gap <= fixture.arrivalRadius, `agent ${agent.id} is ${gap.toFixed(2)} from the goal`);
  }
});

test("an unreachable goal yields no controller", () => {
  const fixture = buildFixtureA();

  // Seal the only opening.
  fixture.map.set(fixture.opening.x, fixture.opening.y, 1);

  const controller = createSquadController({
    agents: createAgents(fixture.startPositions),
    map: fixture.map,
    goal: fixture.goal,
  });

  assert.equal(controller, null);
});

test("the current target is the first waypoint, then the objective", () => {
  const plan = new SquadPlan({
    objective: { x: 9, y: 9 },
    waypoints: [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ],
  });

  assert.deepEqual(plan.currentTarget, { x: 1, y: 1 });
  assert.deepEqual(plan.consumeNextWaypoint(), { x: 1, y: 1 });
  assert.deepEqual(plan.currentTarget, { x: 2, y: 2 });

  plan.consumeNextWaypoint();
  assert.equal(plan.hasWaypoints, false);
  assert.deepEqual(plan.currentTarget, { x: 9, y: 9 });
  assert.equal(plan.consumeNextWaypoint(), null);
});

test("waypoints advance only once the farthest agent is inside the arrival radius", () => {
  const map = buildOpenMap(20, 20);
  const agents = createAgents([
    { x: 2, y: 2 },
    { x: 18, y: 18 },
  ]);

  const plan = new SquadPlan({
    objective: { x: 10, y: 10 },
    waypoints: [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ],
  });

  const controller = createSquadController({
    agents: [agents[0]],
    map,
    goal: { x: 10, y: 10 },
  });
  controller.plan = plan;
  controller.agents = agents;

  // The straggler is far outside GroupArrivalRadius, so nothing is consumed.
  controller.tick(0.1);
  assert.equal(controller.plan.waypoints.length, 2);
  assert.ok(controller.farthestDistance > DEFAULT_STEERING_PARAMS.GroupArrivalRadius);

  // Bring it in, and the waypoint is consumed on the next tick.
  agents[1].position = { x: 3.2, y: 3.2 };
  controller.tick(0.1);
  assert.equal(controller.plan.waypoints.length, 1);
});

test("a held squad builds context but does not move", () => {
  const map = buildOpenMap(20, 20);
  const agents = createAgents([{ x: 2, y: 2 }]);
  const controller = createSquadController({ agents, map, goal: { x: 10, y: 10 } });

  controller.plan.state = SquadState.Hold;
  controller.tick(0.1);

  assert.deepEqual(agents[0].position, { x: 2, y: 2 });
  assert.deepEqual(agents[0].velocity, { x: 0, y: 0 });
});

test("speed is clamped to MaxSpeed during integration", () => {
  const map = buildOpenMap(40, 40);
  const agents = createAgents([{ x: 2, y: 2 }]);
  const controller = createSquadController({ agents, map, goal: { x: 35, y: 35 } });

  for (let i = 0; i < 100; i += 1) {
    controller.tick(0.1);
    const speed = Math.hypot(agents[0].velocity.x, agents[0].velocity.y);
    assert.ok(speed <= DEFAULT_STEERING_PARAMS.MaxSpeed + 1e-9);
  }
});

test("the flock context is read-only and holds one entry per agent", () => {
  const map = buildOpenMap(20, 20);
  const agents = createAgents([
    { x: 2, y: 2 },
    { x: 3, y: 2 },
  ]);
  const controller = createSquadController({ agents, map, goal: { x: 10, y: 10 } });
  const context = controller.tick(0.1);

  assert.equal(context.count, 2);
  assert.equal(context.positions.length, 2);
  assert.equal(context.velocities.length, 2);
  assert.equal(context.slots.length, 2);
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.positions));
  assert.throws(() => {
    "use strict";
    context.positions[0].x = 99;
  });
});

test("path attraction runs first and the centroid push last", () => {
  assert.deepEqual(DEFAULT_TICK_BEHAVIOR_ORDER, [
    "PathAttraction",
    "Separation",
    "Cohesion",
    "Alignment",
    "FormationSlot",
    "ObstacleAvoidance",
    "CentroidPush",
  ]);
});

function marchOnOpenMap({ formation, formationSpacing, maxTicks = 1000 }) {
  const map = buildOpenMap(30, 30);
  const agents = createAgents([
    { x: 2, y: 2 },
    { x: 2.3, y: 2 },
    { x: 2.6, y: 2 },
    { x: 2.9, y: 2 },
    { x: 3.2, y: 2 },
  ]);

  const goal = { x: 25, y: 25 };
  const controller = createSquadController({ agents, map, goal, formation, formationSpacing });

  let arrived = false;
  for (let i = 0; i < maxTicks && !arrived; i += 1) {
    controller.tick(0.1);
    arrived = controller.hasArrived(2.0);
  }

  return { controller, agents, goal, arrived };
}

test("every formation reaches the goal on an open map", () => {
  for (const formation of Object.values(FormationType)) {
    // Slots must fit inside GroupArrivalRadius, or waypoints never advance.
    const { arrived } = marchOnOpenMap({ formation, formationSpacing: 0.6 });
    assert.ok(arrived, `${formation} squad failed to reach the goal`);
  }
});

test("a formation deeper than GroupArrivalRadius stalls waypoint progression", () => {
  // Five agents at the default 1.2 spacing make a 4.8-long column, so its tail
  // can never be within GroupArrivalRadius (2.5) of the squad's target and the
  // waypoint gate never opens. This is a property of the specified gating rule,
  // recorded here so a port can tell it apart from a regression.
  const { arrived, controller, goal } = marchOnOpenMap({
    formation: FormationType.Column,
    formationSpacing: 1.2,
  });

  assert.equal(arrived, false);
  assert.ok(controller.farthestAgentDistance(goal) > 2.0);
});
