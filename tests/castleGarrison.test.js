import assert from "node:assert/strict";
import test from "node:test";

import { generateCastle } from "../src/castle/generate.js";
import { hasLineOfSight } from "../src/sim/gridMap.js";
import { AlertState, Guard, GuardStance, canSee } from "../src/castle/garrison.js";
import { WardId } from "../src/castle/vectors.js";
import { WardType } from "../src/castle/wards.js";

const SIZE = 80;

function build(seed = 0, garrison = {}) {
  return generateCastle({ width: SIZE, height: SIZE, seed, garrison });
}

/** Runs the garrison with one intruder standing still at a point. */
function watch(garrison, point, seconds, dt = 1 / 20) {
  const intruder = { position: point, isAlive: true };

  for (let i = 0; i < Math.round(seconds / dt); i += 1) {
    garrison.tick(dt, [intruder]);
  }

  return intruder;
}

test("the castle is manned, and more densely the deeper you go", () => {
  for (let seed = 0; seed < 8; seed += 1) {
    const { castle, garrison } = build(seed);

    assert.ok(garrison.guards.length >= 12, `seed ${seed}: only ${garrison.guards.length} guards`);

    const densities = castle.wardList.map((ward) => {
      const count = garrison.guardsIn(ward.id).length;
      assert.ok(count > 0, `seed ${seed}: ${ward.type} is unmanned`);
      return (100 * count) / ward.tileCount;
    });

    assert.ok(densities[3] > densities[2], `seed ${seed}: the keep is not held hardest`);
    assert.ok(densities[2] > densities[1], `seed ${seed}: the inner ward is no denser than the outer`);
    assert.ok(densities[1] > densities[0], `seed ${seed}: the bailey is no denser than open ground`);
  }
});

test("every guard has somewhere to be", () => {
  const { castle, garrison } = build(1);

  for (const guard of garrison.guards) {
    const cell = castle.map.worldToGrid(guard.position);
    assert.ok(castle.map.isWalkable(cell.x, cell.y), `${guard.id} is standing in a wall`);
    assert.ok(guard.follower.waypoints.length > 0, `${guard.id} has no beat`);
  }
});

test("no patrol leg walks through a wall, and no beat leaves its ward", () => {
  for (let seed = 0; seed < 6; seed += 1) {
    const { castle } = build(seed);

    for (const ward of castle.wardList) {
      for (const route of ward.patrolRoutes) {
        assert.ok(route.waypoints.length > 0, `seed ${seed}: an empty route in ${ward.type}`);

        for (let i = 0; i < route.waypoints.length; i += 1) {
          const from = route.waypoints[i];
          // Routes are loops, so the leg back to the start is a leg like any other.
          const to = route.waypoints[(i + 1) % route.waypoints.length];

          assert.ok(
            hasLineOfSight(castle.map, from, to),
            `seed ${seed}: ${route.id} walks through something solid`,
          );
          assert.equal(
            castle.wardAtWorld(from)?.id,
            ward.id,
            `seed ${seed}: ${route.id} leaves the ${ward.type}`,
          );
        }
      }
    }
  }
});

test("a guard sees ahead, not behind, and not through a wall", () => {
  const { castle, garrison } = build(0);
  const rally = castle.landmarks.rally;
  const post = castle.map.gridToWorldCenter(rally.x, rally.y);

  const guard = new Guard({ id: "watch", position: post, wardId: WardId.Approach, facing: { x: 1, y: 0 } });

  assert.ok(canSee(guard, { x: post.x + 3, y: post.y }, castle.map, garrison.params), "ahead");
  assert.ok(!canSee(guard, { x: post.x - 5, y: post.y }, castle.map, garrison.params), "behind");
  assert.ok(!canSee(guard, { x: post.x + 40, y: post.y }, castle.map, garrison.params), "too far");

  // The princess is inside three rings of masonry; nobody outside can see her.
  const princess = castle.map.gridToWorldCenter(castle.princess.x, castle.princess.y);
  const longSighted = new Guard({
    id: "eagle",
    position: post,
    wardId: WardId.Approach,
    visionRange: 200,
    facing: { x: princess.x - post.x, y: princess.y - post.y },
  });

  assert.ok(!canSee(longSighted, princess, castle.map, garrison.params), "through the walls");
});

test("a guard who sees something commits to it, then lets it go", () => {
  const { castle, garrison } = build(0);
  const rally = castle.map.gridToWorldCenter(castle.landmarks.rally.x, castle.landmarks.rally.y);

  const guard = new Guard({ id: "solo", position: rally, wardId: WardId.Approach, facing: { x: 1, y: 0 } });
  garrison.guards = [guard];

  const seen = { position: { x: rally.x + 2, y: rally.y }, isAlive: true };
  garrison.tick(0.5, [seen]);
  assert.ok(guard.suspicion > 0, "he has noticed something");

  for (let i = 0; i < 20; i += 1) {
    garrison.tick(0.1, [seen]);
  }

  assert.equal(guard.alert, AlertState.Alerted);
  assert.equal(garrison.sightings, 1);
  assert.ok(garrison.events.some((event) => event.type === "sighting"));

  for (let i = 0; i < 200; i += 1) {
    garrison.tick(0.1, []);
  }

  assert.equal(guard.alert, AlertState.Unaware, "with nothing to see, he stands down");
});

test("a shout raises the men in earshot, through walls", () => {
  const { castle, garrison } = build(0);
  const rally = castle.map.gridToWorldCenter(castle.landmarks.rally.x, castle.landmarks.rally.y);

  const shouter = new Guard({ id: "a", position: rally, wardId: WardId.Approach, facing: { x: 1, y: 0 } });
  const hearer = new Guard({
    id: "b",
    position: { x: rally.x + 4, y: rally.y },
    wardId: WardId.Approach,
    facing: { x: -1, y: 0 },
  });
  const distant = new Guard({
    id: "c",
    position: { x: rally.x + 40, y: rally.y },
    wardId: WardId.Approach,
    facing: { x: 1, y: 0 },
  });

  garrison.guards = [shouter, hearer, distant];
  shouter.suspicion = 2;
  shouter.lastKnown = { x: rally.x + 1, y: rally.y };
  garrison.updateGuardAlert(shouter);

  assert.ok(hearer.suspicion >= garrison.params.suspiciousAt, "the man next to him looks up");
  assert.ok(hearer.lastKnown, "and he knows where to look");
  assert.equal(distant.suspicion, 0, "the far side of the castle heard nothing");
});

test("a noise raises the garrison with nobody having seen anything", () => {
  const { castle, garrison } = build(0);
  const gate = castle.edges.find((edge) => edge.toWard === WardId.OuterBailey && !edge.isWeakPoint);
  const point = castle.map.gridToWorldCenter(gate.location.x, gate.location.y);

  const before = garrison.alertLevel;
  garrison.disturb(point, 0.8, 20);

  assert.ok(garrison.alertLevel > before, "the castle heard it");
  assert.ok(garrison.guards.some((guard) => guard.alert !== AlertState.Unaware));
  assert.ok(garrison.events.some((event) => event.type === "noise"));
});

test("enough alerted men raise the ward, and the ward tells its neighbours", () => {
  const { castle, garrison } = build(0);
  const bailey = castle.wardOfType(WardType.OuterBailey);
  const point = castle.map.gridToWorldCenter(bailey.centroid.x, bailey.centroid.y);

  for (const guard of garrison.guardsIn(bailey.id)) {
    guard.suspicion = 2;
    guard.lastKnown = point;
    garrison.updateGuardAlert(guard);
  }

  watch(garrison, point, 6);

  assert.ok(garrison.alarmIn(bailey.id) >= garrison.params.alarmThreshold, "the ward is up");
  assert.ok(garrison.alarmed.has(bailey.id));
  assert.ok(garrison.events.some((event) => event.type === "alarm"));

  for (const neighborId of castle.neighbors(bailey.id, { openOnly: false })) {
    assert.ok(garrison.alarmIn(neighborId) > 0, `ward ${neighborId} heard nothing`);
  }
});

test("an alarm brings a relief column from the ward behind it", () => {
  const { castle, garrison } = build(0);
  const bailey = castle.wardOfType(WardType.OuterBailey);
  const point = castle.map.gridToWorldCenter(bailey.centroid.x, bailey.centroid.y);

  for (const guard of garrison.guardsIn(bailey.id)) {
    guard.suspicion = 2;
    guard.lastKnown = point;
    garrison.updateGuardAlert(guard);
  }

  // Caught while it is still marching: on a small map a column can form, arrive
  // and disband inside the window, and there would be nothing left to inspect.
  const intruder = { position: point, isAlive: true };
  let squad = null;

  for (let i = 0; i < 400 && !squad; i += 1) {
    garrison.tick(0.05, [intruder]);
    squad = garrison.squads[0] ?? null;
  }

  assert.ok(garrison.reinforcementsSent > 0, "nobody came");
  assert.ok(garrison.events.some((event) => event.type === "reinforce"));
  assert.ok(squad, "the column is on the road");
  // Relief marches under the project's formation controller, like any squad.
  assert.ok(squad.controller.agents.length >= 1);
  assert.ok(squad.controller.slots.length === squad.controller.agents.length);
  assert.ok(castle.ward(squad.fromWard).depth > bailey.depth, "help comes from deeper in");
  assert.ok(squad.guards.every((guard) => guard.stance === GuardStance.Reinforce));
});

test("a ward never strips itself to reinforce another", () => {
  const { castle, garrison } = build(3);
  const inner = castle.wardOfType(WardType.InnerBailey);
  const before = garrison.guardsIn(castle.wardOfType(WardType.Keep).id).length;
  const point = castle.map.gridToWorldCenter(inner.centroid.x, inner.centroid.y);

  for (const guard of garrison.guardsIn(inner.id)) {
    guard.suspicion = 2;
    guard.lastKnown = point;
    garrison.updateGuardAlert(guard);
  }

  watch(garrison, point, 10);

  const marching = garrison.squads.flatMap((squad) => squad.guards).length;
  assert.ok(marching <= Math.floor(before / 2), `the keep sent ${marching} of ${before}`);
});

test("men sent to an alarm find their way back to their own ward", () => {
  const { castle, garrison } = build(0, { investigateSeconds: 1 });
  const bailey = castle.wardOfType(WardType.OuterBailey);
  const point = castle.map.gridToWorldCenter(bailey.centroid.x, bailey.centroid.y);

  for (const guard of garrison.guardsIn(bailey.id)) {
    guard.suspicion = 2;
    guard.lastKnown = point;
    garrison.updateGuardAlert(guard);
  }

  const intruder = { position: point, isAlive: true };
  const marched = [];

  for (let i = 0; i < 400 && marched.length === 0; i += 1) {
    garrison.tick(0.05, [intruder]);
    marched.push(...garrison.squads.flatMap((squad) => squad.guards));
  }

  assert.ok(marched.length > 0, "nobody marched");

  // Long enough with nothing happening for the whole castle to settle.
  for (let i = 0; i < 4000; i += 1) {
    garrison.tick(0.05, []);
  }

  for (const guard of marched) {
    assert.equal(guard.wardId, guard.homeWardId, `${guard.id} never went home`);
    assert.equal(guard.stance, GuardStance.Patrol);
  }

  assert.ok(garrison.alertLevel < 0.05, `the castle stayed jumpy: ${garrison.alertLevel}`);
});

test("the alert reflects how deep the trouble is", () => {
  const { castle, garrison } = build(0);

  garrison.alarms.set(WardId.Approach, 1);
  const shallow = garrison.alertLevel;

  garrison.alarms.set(WardId.Approach, 0);
  garrison.alarms.set(WardId.Keep, 1);
  const deep = garrison.alertLevel;

  assert.ok(deep > shallow, "a fight in the keep should worry the castle more than one in a field");
  assert.ok(shallow > 0, "but a field full of shouting still counts");
});
