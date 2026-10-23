import { ArmyStatus, NEUTRAL } from "../world.js";
import { DecisionError, QuestionType, collectAnswers } from "./decisionsApi.js";
import { answerLocally, createHeuristicProvider } from "./heuristic.js";

/**
 * A faction's strategic commander: the bridge between the world and a decision
 * model.
 *
 * Every few seconds it photographs the world from its faction's side, asks one
 * question per idle army ("where does this army go?") and one about the
 * treasury ("raise a new army now?"), and turns the answers into orders. That
 * is the System 1 split: the model makes fast, typed calls about *what* to do;
 * the world's rules decide what happens.
 *
 * The provider is pluggable — Jev, any endpoint speaking the same API, or the
 * local heuristic. Whatever the provider gets wrong or fails to answer, the
 * heuristic answers instead, so a dropped call costs a faction one round of
 * judgement rather than a frozen army. Each round records where every answer
 * came from.
 */

const round1 = (value) => Math.round(value * 10) / 10;
const regionKey = (id) => `r${id}`;
const armyQuestionId = (id) => `army_${id}`;

/** Total strength of everything in a region that is hostile to `factionId`. */
function hostileAt(world, regionId, factionId) {
  const region = world.regions[regionId];
  let total = region.owner !== factionId ? region.garrison : 0;
  for (const army of world.armiesIn(regionId)) {
    if (army.faction !== factionId) {
      total += army.strength;
    }
  }
  return total;
}

/** Enemy strength that could arrive at a region next: idle next door, or already marching in. */
function threatTo(world, regionId, factionId) {
  let threat = 0;
  for (const neighbor of world.regions[regionId].neighbors) {
    for (const army of world.armiesIn(neighbor)) {
      if (army.faction !== factionId) {
        threat += army.strength;
      }
    }
  }
  for (const army of world.armiesBound(regionId)) {
    if (army.faction !== factionId) {
      threat += army.strength;
    }
  }
  return threat;
}

/** Hops from every region to the nearest region `factionId` does not own — how far each one is from the front. */
export function frontHops(world, factionId) {
  const hops = world.regions.map((r) => (r.owner === factionId ? Infinity : 0));
  const queue = world.regions.filter((r) => r.owner !== factionId).map((r) => r.id);
  while (queue.length > 0) {
    const id = queue.shift();
    for (const next of world.regions[id].neighbors) {
      if (hops[next] === Infinity) {
        hops[next] = hops[id] + 1;
        queue.push(next);
      }
    }
  }
  return hops;
}

function ownerName(world, ownerId) {
  return ownerId ? world.faction(ownerId).name : NEUTRAL;
}

/** The numbers behind each order an army could be given. The heuristic reads these; the prose is built from them. */
export function describeArmyOptions(world, army) {
  const me = army.faction;
  const here = world.regions[army.region];
  const ownHere = world.armiesIn(here.id).filter((a) => a.faction === me).reduce((s, a) => s + a.strength, 0);
  const enemyHere = hostileAt(world, here.id, me);
  const contested = here.contested || (enemyHere > 0 && here.owner !== me);
  const losing = contested && ownHere < enemyHere;
  const front = frontHops(world, me);

  const options = [
    {
      key: "hold",
      kind: "hold",
      region: here.id,
      strength: army.strength,
      contested,
      ownHere,
      enemyHere,
      owned: here.owner === me,
      captureProgress: here.captureProgress,
      threat: here.owner === me ? threatTo(world, here.id, me) : 0,
    },
  ];

  for (const id of here.neighbors) {
    const region = world.regions[id];
    const relation = region.owner === me ? "self" : region.owner ? "enemy" : "neutral";
    const bound = world.armiesBound(id);
    options.push({
      key: regionKey(id),
      kind: "move",
      region: here.id,
      to: id,
      strength: army.strength,
      relation,
      owner: region.owner,
      income: region.income,
      garrison: region.garrison,
      defense: relation === "self" ? 0 : hostileAt(world, id, me) + bound.filter((a) => a.faction !== me).reduce((s, a) => s + a.strength, 0),
      defenderBonus: world.params.defenderBonus,
      friendlyBound: bound.filter((a) => a.faction === me).reduce((s, a) => s + a.strength, 0),
      friendlyThere: world.armiesIn(id).filter((a) => a.faction === me).reduce((s, a) => s + a.strength, 0),
      enemyCapital: Boolean(region.capitalOf && region.capitalOf !== me),
      ownCapital: region.capitalOf === me,
      threat: relation === "self" ? threatTo(world, id, me) : 0,
      towardFront: relation === "self" && front[id] < front[here.id],
      retreating: losing,
    });
  }

  return options;
}

function describeOption(world, option) {
  if (option.kind === "hold") {
    const here = world.regions[option.region];
    if (option.contested) {
      return `Stay and fight at ${here.name}: our ${round1(option.ownHere)} against ${round1(option.enemyHere)} hostile.`;
    }
    if (!option.owned) {
      return `Stay at ${here.name} and finish capturing it (${round1(option.captureProgress)} of ${world.params.captureSeconds} s done).`;
    }
    return option.threat > 0
      ? `Stay and guard ${here.name}; ${round1(option.threat)} enemy strength could reach it next.`
      : `Stay at ${here.name}; nothing threatens it.`;
  }

  const region = world.regions[option.to];
  const tags = [`income ${region.income}`];
  if (region.capitalOf) {
    tags.push(`${option.ownCapital ? "our" : `${ownerName(world, region.capitalOf)}'s`} capital`);
  }
  if (option.relation === "self") {
    tags.push(option.threat > 0 ? `${round1(option.threat)} enemy strength could reach it next` : "not threatened");
    if (option.towardFront) {
      tags.push("one step closer to the front");
    }
    if (option.friendlyThere > 0) {
      tags.push(`our army of ${round1(option.friendlyThere)} is there and would merge with this one`);
    }
    return `Move to ${region.name} (ours; ${tags.join("; ")}).`;
  }
  tags.push(`defended by ${round1(option.defense)}`);
  if (option.friendlyBound > 0) {
    tags.push(`${round1(option.friendlyBound)} of ours already marching there`);
  }
  return `Attack ${region.name} (${ownerName(world, option.owner)}; ${tags.join("; ")}).`;
}

/** The world as the faction sees it — the `state` half of a decisions request. */
export function describeState(world, factionId) {
  const me = world.faction(factionId);
  const p = world.params;

  return {
    you: me.name,
    goal: `Take over the map: hold ${Math.ceil(world.regions.length * p.dominationShare)} of ${world.regions.length} regions, or be the last faction standing.`,
    rules: [
      "Regions pay income every second; gold raises new armies at your capital.",
      `Your total army strength cannot exceed ${p.supplyPerIncome}x your income; more regions support a bigger army.`,
      "Armies only fight where they stop. Everything in a region — every army present and the owner's garrison — fights at once.",
      `Each side loses ${p.lethality} strength per second per point of enemy strength; the region's owner deals ${p.defenderBonus}x damage.`,
      `An army alone in a region it does not own captures it after ${p.captureSeconds} seconds.`,
      "Two of your armies in the same region merge into one.",
      `Armies march about ${p.armySpeed} tiles per second and cannot be redirected on the way.`,
    ],
    time_seconds: Math.round(world.time),
    gold: round1(me.gold),
    income_per_second: round1(world.incomeOf(factionId) * p.goldPerIncome),
    army_strength: round1(world.armyStrengthOf(factionId)),
    supply_cap: round1(world.supplyOf(factionId)),
    factions: world.factions.map((f) => ({
      name: f.name,
      regions: world.regionsOf(f.id).length,
      army_strength: round1(world.armyStrengthOf(f.id)),
      capital: `${world.regions[f.capital].name} (held by ${ownerName(world, world.regions[f.capital].owner)})`,
      eliminated: f.eliminated,
    })),
    regions: world.regions.map((r) => ({
      id: regionKey(r.id),
      name: r.name,
      owner: ownerName(world, r.owner),
      income: r.income,
      garrison: round1(r.garrison),
      ...(r.capitalOf ? { capital_of: ownerName(world, r.capitalOf) } : {}),
      neighbors: r.neighbors.map(regionKey),
      armies: world.armiesIn(r.id).map((a) => ({ faction: world.faction(a.faction).name, strength: round1(a.strength) })),
    })),
    armies_on_the_march: world.armies
      .filter((a) => a.status === ArmyStatus.MARCHING)
      .map((a) => ({
        faction: world.faction(a.faction).name,
        strength: round1(a.strength),
        to: regionKey(a.destination),
      })),
  };
}

/**
 * Builds the decisions request for one faction, and the side channel the
 * heuristic and the order step need.
 *
 * @returns {{request: object, context: {factionId: string, options: object, canRecruit: boolean}}}
 */
export function buildDecisionRequest(world, factionId) {
  const questions = {};
  const options = {};
  const p = world.params;

  for (const army of world.armiesOf(factionId)) {
    if (army.status !== ArmyStatus.IDLE) {
      continue;
    }
    const id = armyQuestionId(army.id);
    const armyOptions = describeArmyOptions(world, army).map((o) => ({ ...o, armyId: army.id }));
    options[id] = armyOptions;
    questions[id] = {
      type: QuestionType.CHOICE,
      instructions: `Army ${army.id} (strength ${round1(army.strength)}) is at ${world.regions[army.region].name}. Choose its next order.`,
      criteria: Object.fromEntries(armyOptions.map((o) => [o.key, describeOption(world, o)])),
    };
  }

  const canRecruit = world.canRecruit(factionId);
  if (canRecruit) {
    const muster = world.regions[world.musterRegion(factionId)];
    questions.recruit = {
      type: QuestionType.NOUL,
      instructions: `Spend ${p.recruitCost} gold now to raise a new army of strength ${p.recruitStrength} at ${muster.name}?`,
      criteria: {
        true: "Raise the army now.",
        false: "Save the gold for later.",
      },
    };
  }

  return {
    request: {
      state: describeState(world, factionId),
      questions,
      session_id: `rts-${world.seed}-${factionId}`,
    },
    context: { factionId, options, canRecruit },
  };
}

/** Applies answers as orders. Answers that no longer fit the world (the army died, or moved) are dropped by the world. */
export function applyAnswers(world, context, answers) {
  const orders = [];

  for (const [id, answer] of Object.entries(answers)) {
    if (id === "recruit") {
      if (answer.noul >= 0.5) {
        const army = world.recruit(context.factionId);
        orders.push({ question: id, order: "recruit", applied: Boolean(army) });
      }
      continue;
    }

    const option = context.options[id]?.find((o) => o.key === answer.choice);
    if (!option) {
      continue;
    }
    const order = option.kind === "hold" ? { type: "hold" } : { type: "move", to: option.to };
    const stillThere = world.army(option.armyId)?.region === option.region;
    const applied = stillThere && world.orderArmy(context.factionId, option.armyId, order);
    orders.push({ question: id, order: option.key, applied });
  }

  return orders;
}

export class StrategicCommander {
  /**
   * @param {object} options
   * @param {import("../world.js").RtsWorld} options.world
   * @param {string} options.factionId
   * @param {{kind: string, name: string, decide: Function}} [options.provider]
   * @param {number} [options.offset] Seconds before the first decision, to stagger factions.
   */
  constructor({ world, factionId, provider = createHeuristicProvider(), offset = 0 }) {
    this.world = world;
    this.factionId = factionId;
    this.provider = provider;
    this.timer = offset;
    this.pending = null;
    this.rounds = 0;
    this.lastRound = null;
    this.totalCost = 0;
    this.failures = 0;
  }

  /**
   * Advances the commander's clock. Starts a decision round when one is due
   * and none is in flight.
   *
   * @returns {Promise|null} the round started this tick, so a lockstep caller can await it.
   */
  update(dt) {
    const faction = this.world.faction(this.factionId);
    if (this.pending || faction.eliminated || this.world.winner) {
      return null;
    }
    this.timer -= dt;
    if (this.timer > 0) {
      return null;
    }
    this.timer = this.world.params.decisionInterval;
    this.pending = this.decide().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async decide() {
    const { request, context } = buildDecisionRequest(this.world, this.factionId);
    if (Object.keys(request.questions).length === 0) {
      return null;
    }

    const started = now();
    let answers = {};
    let sources = {};
    let error = null;
    let response = null;

    try {
      response = await this.provider.decide(request, context);
      const collected = collectAnswers(request, response);
      answers = collected.answers;
      sources = Object.fromEntries(Object.keys(answers).map((id) => [id, this.provider.kind]));
      if (collected.rejected.length > 0) {
        error = new DecisionError(`Unusable answers for: ${collected.rejected.join(", ")}`);
      }
      this.totalCost += Number(response?.usage?.cost) || 0;
    } catch (caught) {
      error = caught instanceof DecisionError ? caught : new DecisionError(caught?.message ?? String(caught), { cause: caught });
    }

    const missing = Object.keys(request.questions).filter((id) => !answers[id]);
    if (missing.length > 0) {
      const filled = answerLocally(request, context, missing);
      for (const id of missing) {
        answers[id] = filled[id];
        sources[id] = "fallback";
      }
    }
    if (error) {
      this.failures += 1;
    }

    // The world kept moving while the model thought. Orders for armies that are no longer idle, or no longer
    // where the question found them, are rejected by the world and recorded as not applied.
    const orders = applyAnswers(this.world, context, answers);
    this.rounds += 1;
    this.lastRound = {
      time: this.world.time,
      latencyMs: Math.round(now() - started),
      model: response?.model ?? this.provider.name,
      questions: request.questions,
      answers,
      sources,
      orders,
      error: error?.message ?? null,
    };
    return this.lastRound;
  }
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}
