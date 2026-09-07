import assert from "node:assert/strict";
import test from "node:test";

import { generateCastle } from "../src/castle/generate.js";
import { CastleTile } from "../src/castle/layout.js";
import { ApproachStyle, CastleMission, MissionPhase } from "../src/castle/mission.js";
import { WardId } from "../src/castle/vectors.js";
import { TraversalType, VectorType, WardType } from "../src/castle/wards.js";
import { createAgents } from "../src/sim/agent.js";

const SIZE = 80;

/** A castle with a party standing at the rally point, out in the open. */
function stage(seed = 0, { partySize = 3, params = {} } = {}) {
  const { castle, garrison } = generateCastle({ width: SIZE, height: SIZE, seed });
  const rally = castle.map.gridToWorldCenter(castle.landmarks.rally.x, castle.landmarks.rally.y);
  const party = createAgents(
    Array.from({ length: partySize }, (_, i) => ({ x: rally.x + i * 0.6, y: rally.y })),
    { idPrefix: "raider" },
  );

  return { castle, garrison, party, rally, mission: new CastleMission({ castle, garrison, party, params }) };
}

function run(mission, seconds, dt = 1 / 20) {
  for (let i = 0; i < Math.round(seconds / dt); i += 1) {
    mission.tick(dt);
  }
}

test("a castle nobody has disturbed stays quiet, and bars nothing", () => {
  const { mission, castle } = stage(0);

  // The party stands in the corner of the map, out of everyone's way.
  for (const member of mission.party) {
    member.position = { x: 2.5, y: 2.5 };
  }

  run(mission, 30);

  assert.ok(mission.alertLevel < 0.1, `the castle got jumpy on its own: ${mission.alertLevel}`);
  assert.equal(mission.phase, MissionPhase.Infiltrate);
  assert.equal(mission.style, ApproachStyle.Stealth);

  // A door on a timetable may well be shut; nothing should be shut *at* them.
  for (const edge of castle.edges) {
    assert.ok(!edge.barredByAlert, `the ${edge.vectorType} was barred against a party nobody saw`);
  }
});

test("the alert bars the quiet ways in, and calming down unbars them", () => {
  const { mission, castle, garrison } = stage(0);
  const quiet = castle
    .activeVectors()
    .filter((edge) => edge.traversalType === TraversalType.Stealth && edge.isOpen);

  assert.ok(quiet.length > 0, "this seed has no quiet way in to test");

  garrison.alarms.set(WardId.OuterBailey, 1);
  garrison.alarms.set(WardId.InnerBailey, 1);
  mission.tickAlertResponse();

  for (const edge of quiet) {
    assert.ok(!edge.isOpen, `the ${edge.vectorType} stayed open under alarm`);
    assert.ok(edge.barredByAlert);
    assert.ok(edge.tiles.every((tile) => !castle.map.isWalkable(tile.x, tile.y)), "it is shut on the map");
  }

  for (const ward of castle.wardList) {
    garrison.alarms.set(ward.id, 0);
  }
  mission.tickAlertResponse();

  for (const edge of quiet) {
    assert.ok(edge.isOpen, `the ${edge.vectorType} stayed barred after the alarm passed`);
    assert.ok(edge.tiles.every((tile) => castle.map.isWalkable(tile.x, tile.y)));
  }
});

test("a door cannot be barred on someone standing in it", () => {
  const { mission, castle, garrison } = stage(0);
  const quiet = castle
    .activeVectors()
    .find((edge) => edge.traversalType === TraversalType.Stealth && edge.isOpen);

  assert.ok(quiet, "this seed has no quiet way in to test");

  const doorway = quiet.tiles.find((tile) => castle.map.isWalkable(tile.x, tile.y));
  mission.party[0].position = castle.map.gridToWorldCenter(doorway.x, doorway.y);

  for (const ward of castle.wardList) {
    garrison.alarms.set(ward.id, 1);
  }
  mission.tickAlertResponse();

  assert.ok(quiet.isOpen, "they shut it on him");
});

test("barring the doors does not wall a sentry into one", () => {
  for (let seed = 0; seed < 6; seed += 1) {
    const { mission, castle, garrison } = stage(seed);

    // Every alarm to full at once, so any doorway a sentry happens to be
    // pacing over is barred underneath him.
    for (const ward of castle.wardList) {
      garrison.alarms.set(ward.id, 1);
    }
    mission.tickAlertResponse();

    assert.ok(
      castle.edges.some((edge) => edge.barredByAlert),
      `seed ${seed}: nothing was barred, so this proves nothing`,
    );

    run(mission, 30);

    for (const guard of garrison.guards) {
      const cell = castle.map.worldToGrid(guard.position);
      assert.ok(
        castle.map.isWalkable(cell.x, cell.y),
        `seed ${seed}: ${guard.id} was shut inside the masonry at ${cell.x},${cell.y}`,
      );
    }
  }
});

test("at full alert the keep is sealed, and can still be forced", () => {
  const { mission, castle, garrison } = stage(0, { params: { forceSeconds: 2 } });
  const keepGate = castle.edges.find(
    (edge) => edge.vectorType === VectorType.Gate && edge.toWard === WardId.Keep,
  );

  for (const ward of castle.wardList) {
    garrison.alarms.set(ward.id, 1);
  }
  mission.tickAlertResponse();

  assert.ok(!keepGate.isOpen, "the keep stayed open at full alert");
  assert.ok(keepGate.tiles.every((tile) => castle.map.get(tile.x, tile.y) === CastleTile.Door));

  // The storm path never disappears: it only gets more expensive.
  const forcer = mission.party[0];
  forcer.position = castle.map.gridToWorldCenter(keepGate.location.x, keepGate.location.y);

  assert.deepEqual(mission.interact(keepGate.id, forcer), { ok: true });
  assert.deepEqual(mission.interact(keepGate.id, forcer), { ok: false, reason: "already under way" });

  run(mission, 3);

  assert.ok(keepGate.isOpen, "the door held forever");
  assert.ok(keepGate.tiles.every((tile) => castle.map.isWalkable(tile.x, tile.y)));
  assert.ok(mission.events.some((event) => event.type === "force-opened"));
});

test("walking away from a half-forced door abandons the attempt", () => {
  const { mission, castle, garrison } = stage(0, { params: { forceSeconds: 5 } });
  const keepGate = castle.edges.find((edge) => edge.toWard === WardId.Keep);

  for (const ward of castle.wardList) {
    garrison.alarms.set(ward.id, 1);
  }
  mission.tickAlertResponse();

  const forcer = mission.party[0];
  forcer.position = castle.map.gridToWorldCenter(keepGate.location.x, keepGate.location.y);
  assert.ok(mission.interact(keepGate.id, forcer).ok);

  forcer.position = { x: 2.5, y: 2.5 };
  mission.tickActions(0.1);

  assert.equal(mission.actions.size, 0);
  assert.ok(!keepGate.isOpen);
  assert.ok(mission.events.some((event) => event.type === "action-abandoned"));
});

test("bringing a breach down is loud, and a sergeant will not be bought once the alarm is up", () => {
  let breachSeed = null;
  let bribeSeed = null;

  for (let seed = 0; seed < 20 && (breachSeed === null || bribeSeed === null); seed += 1) {
    const { castle } = generateCastle({ width: SIZE, height: SIZE, seed });
    const kinds = castle.activeVectors().map((edge) => edge.vectorType);

    if (breachSeed === null && kinds.includes(VectorType.Breach)) {
      breachSeed = seed;
    }
    if (bribeSeed === null && kinds.includes(VectorType.Bribe)) {
      bribeSeed = seed;
    }
  }

  assert.ok(breachSeed !== null && bribeSeed !== null, "no sample seed had both to test");

  const breachRun = stage(breachSeed, { params: { breachSeconds: 1 } });
  const breach = breachRun.castle.activeVectors().find((edge) => edge.vectorType === VectorType.Breach);
  const sapper = breachRun.mission.party[0];
  sapper.position = breachRun.castle.map.gridToWorldCenter(breach.location.x, breach.location.y);

  assert.ok(breachRun.mission.interact(breach.id, sapper).ok);
  run(breachRun.mission, 1.5);

  assert.ok(breach.isOpen, "the wall held");
  assert.ok(breach.tiles.every((tile) => breachRun.castle.map.isWalkable(tile.x, tile.y)));
  assert.ok(breachRun.garrison.alertLevel > 0.05, "nobody heard a wall come down");

  const bribeRun = stage(bribeSeed);
  const bribe = bribeRun.castle.activeVectors().find((edge) => edge.vectorType === VectorType.Bribe);
  const negotiator = bribeRun.mission.party[0];
  negotiator.position = bribeRun.castle.map.gridToWorldCenter(bribe.location.x, bribe.location.y);

  assert.ok(bribeRun.mission.interact(bribe.id, negotiator).ok, "he would not take it while calm");

  bribeRun.mission.actions.clear();
  for (const ward of bribeRun.castle.wardList) {
    bribeRun.garrison.alarms.set(ward.id, 1);
  }

  const refused = bribeRun.mission.interact(bribe.id, negotiator);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /will not take it/);
});

test("the delivery door keeps its own timetable", () => {
  let seed = null;

  for (let candidate = 0; candidate < 20 && seed === null; candidate += 1) {
    const { castle } = generateCastle({ width: SIZE, height: SIZE, seed: candidate });
    if (castle.activeVectors().some((edge) => edge.vectorType === VectorType.Kitchen)) {
      seed = candidate;
    }
  }

  assert.ok(seed !== null, "no sample seed had a delivery door");

  const { mission, castle } = stage(seed);
  const kitchen = castle.activeVectors().find((edge) => edge.vectorType === VectorType.Kitchen);
  const states = new Set();

  assert.ok(kitchen.schedule, "the door has no timetable");

  for (let i = 0; i < 400; i += 1) {
    mission.tickSchedules();
    mission.elapsed += 1;
    states.add(kitchen.isOpen);
  }

  assert.deepEqual([...states].sort(), [false, true], "the door never changed state");
});

test("reaching the princess rescues her, and she follows the party out", () => {
  const { mission, castle } = stage(0);
  const princessCell = castle.princess;

  mission.party[0].position = castle.map.gridToWorldCenter(princessCell.x, princessCell.y);
  mission.tick(0.05);

  assert.ok(mission.princess.rescued);
  assert.equal(mission.phase, MissionPhase.Extract);
  assert.ok(mission.events.some((event) => event.type === "rescued"));

  // She keeps up: walked away from, she closes the gap rather than staying put.
  const escort = mission.party[0];
  escort.position = { x: escort.position.x + 3, y: escort.position.y };
  const before = mission.princess.position.x;
  run(mission, 1);

  assert.notEqual(mission.princess.position.x, before, "she stayed where she was");
});

test("getting her to open ground finishes the run", () => {
  const { mission, castle, rally } = stage(0);

  mission.party[0].position = castle.map.gridToWorldCenter(castle.princess.x, castle.princess.y);
  mission.tick(0.05);
  assert.ok(mission.princess.rescued);

  // Out through the walls the hard way, for the purposes of the test.
  const corner = { x: 2.5, y: 2.5 };
  mission.party[0].position = corner;
  mission.princess.position = { x: corner.x, y: corner.y };
  mission.tick(0.05);

  assert.equal(mission.phase, MissionPhase.Complete);
  assert.ok(mission.isComplete);
  assert.ok(mission.isAtExtraction(corner));
  assert.ok(!mission.isAtExtraction(castle.map.gridToWorldCenter(castle.princess.x, castle.princess.y)));
  assert.ok(rally);
});

test("a party that is beaten falls back and goes again", () => {
  const { mission, castle } = stage(0, { params: { regroupSeconds: 1 } });

  for (const member of mission.party) {
    member.applyDamage(member.maxHealth);
  }

  assert.equal(mission.survivors.length, 0);
  mission.tick(0.05);
  assert.equal(mission.phase, MissionPhase.Regrouping, "a wipe should not be the end of it");
  assert.ok(mission.events.some((event) => event.type === "repulsed"));

  run(mission, 2);

  assert.equal(mission.phase, MissionPhase.Infiltrate);
  assert.equal(mission.attempts, 2);
  assert.equal(mission.survivors.length, mission.party.length);
  assert.ok(!mission.princess.rescued, "she is back in the keep");

  for (const member of mission.party) {
    assert.ok(member.health > 0 && member.health < member.maxHealth, "they came back hurt, not fresh");
    assert.equal(castle.wardAtWorld(member.position).type, WardType.Approach, "they fell back outside");
  }
});

test("the castle sends more men, sooner, the louder it gets", () => {
  const { mission, garrison, castle } = stage(0);

  mission.tickAlertResponse();
  const calmSquad = garrison.params.reinforcementSquad;
  const calmCooldown = garrison.params.reinforcementCooldown;

  for (const ward of castle.wardList) {
    garrison.alarms.set(ward.id, 1);
  }
  mission.tickAlertResponse();

  assert.ok(garrison.params.reinforcementSquad > calmSquad, "the relief column did not grow");
  assert.ok(garrison.params.reinforcementCooldown < calmCooldown, "help did not come sooner");
});

test("the run is judged by the worst it ever got", () => {
  const { mission, garrison, castle } = stage(0);

  assert.equal(mission.style, ApproachStyle.Stealth);

  for (const ward of castle.wardList) {
    garrison.alarms.set(ward.id, 0.6);
  }
  mission.tick(0.05);
  assert.equal(mission.style, ApproachStyle.Contested);

  for (const ward of castle.wardList) {
    garrison.alarms.set(ward.id, 1);
  }
  mission.tick(0.05);
  assert.equal(mission.style, ApproachStyle.Storm);

  // Peak, not current: quietening down afterwards does not buy back a stealth run.
  for (const ward of castle.wardList) {
    garrison.alarms.set(ward.id, 0);
  }
  mission.tick(0.05);
  assert.equal(mission.style, ApproachStyle.Storm);
});

test("the way in is recorded by what the party walks through", () => {
  const { mission, castle } = stage(0);
  const gate = castle.edges.find((edge) => edge.fromWard === WardId.Approach && !edge.isWeakPoint);
  const tile = gate.tiles.find((cell) => castle.map.isWalkable(cell.x, cell.y));

  assert.equal(mission.snapshot().entryUsed, null);

  mission.party[0].position = castle.map.gridToWorldCenter(tile.x, tile.y);
  mission.tick(0.05);

  assert.equal(mission.entryUsed, gate.id);
  assert.ok(mission.events.some((event) => event.type === "entered"));
});
