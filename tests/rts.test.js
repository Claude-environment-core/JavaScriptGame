import assert from "node:assert/strict";
import test from "node:test";

import { RTS_DEFAULTS } from "../src/rts/config.js";
import { StrategicCommander, applyAnswers, buildDecisionRequest } from "../src/rts/decisions/commander.js";
import {
  DEFAULT_DECISION_MODEL,
  DecisionError,
  OPENROUTER_DECISIONS_ENDPOINT,
  collectAnswers,
  createDecisionModelProvider,
} from "../src/rts/decisions/decisionsApi.js";
import { answerChoice, createHeuristicProvider } from "../src/rts/decisions/heuristic.js";
import { generateStrategicMap, regionHops } from "../src/rts/mapGen.js";
import { createMatch, runMatch } from "../src/rts/match.js";
import { ArmyStatus, RtsWorld } from "../src/rts/world.js";

/** Runs the world forward with no commanders. */
function run(world, seconds, dt = 1 / 10) {
  for (let i = 0; i < Math.round(seconds / dt); i += 1) {
    world.tick(dt);
  }
}

/** A fetch stand-in that records the call and answers with `body`. */
function fakeFetch(body, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return { impl, calls };
}

test("the strategic map is deterministic, connected, and every march route exists", () => {
  const a = generateStrategicMap({ seed: 5 });
  const b = generateStrategicMap({ seed: 5 });
  assert.deepEqual(a.regions, b.regions);
  assert.deepEqual(a.capitals, b.capitals);

  assert.equal(a.regions.length, RTS_DEFAULTS.regionCount);
  assert.ok(regionHops(a.regions, 0).every(Number.isFinite), "every region is reachable from every other");

  for (const region of a.regions) {
    assert.equal(a.regionOf[region.center.x + region.center.y * a.map.width], region.id, "rally point is inside its region");
    for (const neighbor of region.neighbors) {
      assert.ok(a.regions[neighbor].neighbors.includes(region.id), "adjacency is symmetric");
      assert.ok(a.routes.get(`${region.id}>${neighbor}`).length > 0, "adjacent regions have a march route");
    }
  }
});

test("capitals start apart from one another", () => {
  for (const seed of [0, 1, 2, 3]) {
    const { regions, capitals } = generateStrategicMap({ seed });
    assert.equal(new Set(capitals).size, 4);
    for (const capital of capitals) {
      const hops = regionHops(regions, capital);
      for (const other of capitals) {
        if (other !== capital) {
          assert.ok(hops[other] >= 2, `seed ${seed}: capitals ${capital} and ${other} are not neighbours`);
        }
      }
    }
  }
});

test("an army marches to an adjacent region and only along legal orders", () => {
  const world = new RtsWorld({ seed: 0 });
  const army = world.armiesOf("crimson")[0];
  const home = world.regions[army.region];
  const notAdjacent = world.regions.find((r) => r.id !== home.id && !home.neighbors.includes(r.id));

  assert.equal(world.orderArmy("azure", army.id, { type: "move", to: home.neighbors[0] }), false, "not your army");
  assert.equal(world.orderArmy("crimson", army.id, { type: "move", to: notAdjacent.id }), false, "not adjacent");
  assert.equal(world.orderArmy("crimson", army.id, { type: "move", to: home.neighbors[0] }), true);
  assert.equal(army.status, ArmyStatus.MARCHING);
  assert.equal(world.orderArmy("crimson", army.id, { type: "hold" }), false, "no orders on the march");

  run(world, 30);
  assert.equal(army.status, ArmyStatus.IDLE);
  assert.equal(army.region, home.neighbors[0]);
});

test("an army alone in a region takes it once the garrison is beaten", () => {
  const world = new RtsWorld({ seed: 0 });
  const army = world.armiesOf("crimson")[0];
  const target = world.regions[army.region].neighbors.find((id) => !world.regions[id].owner);
  world.orderArmy("crimson", army.id, { type: "move", to: target });

  run(world, 40);
  assert.equal(world.regions[target].owner, "crimson");
  assert.ok(army.strength < RTS_DEFAULTS.startingStrength, "the garrison fought back");
});

test("the stronger side wins a fight, and the owner fights harder", () => {
  const world = new RtsWorld({ seed: 0 });
  const region = world.regions[world.faction("azure").capital];
  const attacker = world.spawnArmy("crimson", region.id, 30);
  const defender = world.armiesOf("azure")[0];

  run(world, 15);
  assert.ok(!world.army(defender.id), "the outnumbered defender is destroyed");
  assert.ok(world.army(attacker.id).strength > 0);

  // Equal armies on neutral ground trade evenly; on one side's ground the owner comes out ahead.
  const even = new RtsWorld({ seed: 0 });
  const ground = even.regions[even.faction("crimson").capital];
  const owner = even.armiesOf("crimson")[0];
  owner.strength = 10;
  ground.garrison = 0;
  const raider = even.spawnArmy("azure", ground.id, 10);
  even.tick(1);
  assert.ok(owner.strength > raider.strength);
});

test("recruiting needs gold, supply, and a muster region with no enemy in it", () => {
  const world = new RtsWorld({ seed: 0 });
  const crimson = world.faction("crimson");
  assert.equal(world.canRecruit("crimson"), false, "no gold yet");

  crimson.gold = 100;
  assert.equal(world.canRecruit("crimson"), true);
  const raised = world.recruit("crimson");
  assert.equal(raised.region, crimson.capital);
  assert.equal(crimson.gold, 100 - RTS_DEFAULTS.recruitCost);

  // Supply: one capital at income 3 supports 18; 8 + 6 already fielded leaves no room for 6 more.
  assert.equal(world.canRecruit("crimson"), false, "supply cap reached");

  // A besieged capital is not a muster point, so a siege cannot be reset from inside.
  const besieged = new RtsWorld({ seed: 0 });
  besieged.faction("azure").gold = 100;
  besieged.armiesOf("azure")[0].strength = 1;
  besieged.spawnArmy("crimson", besieged.faction("azure").capital, 5);
  assert.equal(besieged.musterRegion("azure"), null);
  assert.equal(besieged.recruit("azure"), null);
});

test("a decisions request follows the Decisions API shape", () => {
  const world = new RtsWorld({ seed: 0 });
  world.faction("crimson").gold = 50;
  const { request, context } = buildDecisionRequest(world, "crimson");

  assert.equal(typeof request.state, "object");
  assert.equal(request.state.you, "Crimson");
  assert.equal(request.state.regions.length, world.regions.length);

  const army = world.armiesOf("crimson")[0];
  const question = request.questions[`army_${army.id}`];
  assert.equal(question.type, "choice");
  assert.deepEqual(
    Object.keys(question.criteria),
    ["hold", ...world.regions[army.region].neighbors.map((id) => `r${id}`)],
  );
  for (const description of Object.values(question.criteria)) {
    assert.equal(typeof description, "string");
  }

  assert.equal(request.questions.recruit.type, "noul");
  assert.deepEqual(Object.keys(request.questions.recruit.criteria), ["true", "false"]);
  assert.equal(context.canRecruit, true);
  assert.ok(JSON.stringify(request).length < 20000, "request stays small");
});

test("the heuristic answers in the same shape a decision model does", async () => {
  const world = new RtsWorld({ seed: 0 });
  const { request, context } = buildDecisionRequest(world, "crimson");
  const response = await createHeuristicProvider().decide(request, context);
  const { answers, rejected } = collectAnswers(request, response);

  assert.deepEqual(rejected, []);
  for (const answer of Object.values(answers)) {
    if (answer.type === "choice") {
      const total = Object.values(answer.probabilities).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - 1) < 0.01);
      assert.equal(answer.choice, Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])[0][0]);
    }
  }

  // It attacks what it can beat and avoids what it cannot.
  const choice = answerChoice([
    { key: "hold", kind: "hold", strength: 10, owned: true, threat: 0, contested: false },
    { key: "r1", kind: "move", relation: "enemy", strength: 10, defense: 30, defenderBonus: 1.3, income: 3, friendlyBound: 0 },
    { key: "r2", kind: "move", relation: "neutral", strength: 10, defense: 2, defenderBonus: 1.3, income: 2, friendlyBound: 0 },
  ]);
  assert.equal(choice.choice, "r2");
  assert.ok(choice.probabilities.r1 < 0.05);
});

test("the model provider posts to the decisions endpoint and its answers become orders", async () => {
  const world = new RtsWorld({ seed: 0 });
  world.faction("crimson").gold = 50;
  const army = world.armiesOf("crimson")[0];
  const target = world.regions[army.region].neighbors[0];

  const { impl, calls } = fakeFetch({
    id: "gen-dec-test",
    model: "typesafe/jev-1.13-20260917",
    answers: {
      [`army_${army.id}`]: { type: "choice", choice: `r${target}`, probabilities: { [`r${target}`]: 0.9 }, confidence: 0.8 },
      recruit: { type: "noul", noul: 0.2 },
    },
    usage: { input_tokens: 900, output_tokens: 20, cost: 0.00004 },
  });

  const provider = createDecisionModelProvider({ apiKey: "test-key", fetchImpl: impl });
  const commander = new StrategicCommander({ world, factionId: "crimson", provider });
  const round = await commander.decide();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENROUTER_DECISIONS_ENDPOINT);
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].body.model, DEFAULT_DECISION_MODEL);
  assert.ok(calls[0].body.questions[`army_${army.id}`]);

  assert.equal(round.sources[`army_${army.id}`], "model");
  assert.equal(round.error, null);
  assert.equal(army.status, ArmyStatus.MARCHING);
  assert.equal(army.destination, target);
  assert.equal(world.armiesOf("crimson").length, 1, "the model said not to recruit");
  assert.equal(commander.totalCost, 0.00004);
});

test("bad or missing model answers fall back to the heuristic, question by question", async () => {
  const world = new RtsWorld({ seed: 0 });
  world.faction("crimson").gold = 50;
  const army = world.armiesOf("crimson")[0];

  // An option the question never offered is rejected; the missing recruit answer is filled in.
  const { impl } = fakeFetch({ answers: { [`army_${army.id}`]: { type: "choice", choice: "r999" } } });
  const commander = new StrategicCommander({
    world,
    factionId: "crimson",
    provider: createDecisionModelProvider({ apiKey: "k", fetchImpl: impl }),
  });
  const round = await commander.decide();
  assert.equal(round.sources[`army_${army.id}`], "fallback");
  assert.equal(round.sources.recruit, "fallback");
  assert.match(round.error, /army_/);

  // A failed call costs one round of judgement, not a frozen faction.
  const failing = new StrategicCommander({
    world: new RtsWorld({ seed: 0 }),
    factionId: "crimson",
    provider: createDecisionModelProvider({ apiKey: "k", fetchImpl: fakeFetch({ error: "nope" }, { status: 401 }).impl }),
  });
  const failed = await failing.decide();
  assert.match(failed.error, /HTTP 401/);
  assert.ok(Object.values(failed.sources).every((s) => s === "fallback"));
  assert.equal(failing.failures, 1);

  await assert.rejects(createDecisionModelProvider({}).decide({ questions: {} }), DecisionError);
});

test("answers that arrive after the army has moved on are not applied", () => {
  const world = new RtsWorld({ seed: 0 });
  const army = world.armiesOf("crimson")[0];
  const { context } = buildDecisionRequest(world, "crimson");
  const first = world.regions[army.region].neighbors[0];

  world.orderArmy("crimson", army.id, { type: "move", to: first });
  const orders = applyAnswers(world, context, { [`army_${army.id}`]: { type: "choice", choice: `r${first}` } });
  assert.equal(orders[0].applied, false);
});

test("heuristic-only matches are reproducible and end with a winner", async () => {
  const a = await runMatch({ seed: 3 });
  const b = await runMatch({ seed: 3 });
  assert.equal(a.winner, b.winner);
  assert.equal(a.seconds, b.seconds);
  assert.ok(a.winner, "the match was decided");

  const winnerRegions = a.world.regionsOf(a.winner).length;
  const alive = a.world.factions.filter((f) => !f.eliminated);
  assert.ok(alive.length === 1 || winnerRegions >= Math.ceil(a.world.regions.length * RTS_DEFAULTS.dominationShare));
});

test("commanders stagger their decision rounds", () => {
  const { commanders } = createMatch({ seed: 0 });
  const offsets = commanders.map((c) => c.timer);
  assert.equal(new Set(offsets).size, commanders.length);
});
