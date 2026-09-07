/**
 * The mission over a generated castle: get in, reach the princess, get out.
 *
 * Two things this layer is responsible for, both of them from the brief:
 *
 * **The alert is the difficulty curve.** Nothing about the castle's geometry
 * changes with the player's skill. What changes is what the garrison does with
 * what it knows: quiet ways in get barred once the alarm is up, the keep door
 * is reinforced, and relief columns get bigger and come sooner. A party that
 * stays quiet keeps its options; a party that does not has to take the ones
 * that were always going to be available — the gates, loudly.
 *
 * **Losing is a setback, not an ending.** A party that is beaten falls back to
 * the rally point and can go again, against a castle that is now awake and
 * settling slowly back down. That is what makes a group willing to experiment
 * with a way in that might not work.
 */

import { AgentState } from "../sim/agent.js";
import { clone, distance, vec2 } from "../sim/vec2.js";
import { AlertState, GuardStance } from "./garrison.js";
import { CastleTile, isBufferGround } from "./layout.js";
import { stepToward } from "./patrol.js";
import { WardId } from "./vectors.js";
import { TraversalType, VectorType, WardType } from "./wards.js";

/** Where the run has got to. Failure is `Regrouping`, and it is temporary. */
export const MissionPhase = Object.freeze({
  Infiltrate: "infiltrate",
  Extract: "extract",
  Complete: "complete",
  Regrouping: "regrouping",
});

/** How the run was played, judged at the moment the princess was reached. */
export const ApproachStyle = Object.freeze({
  Stealth: "stealth",
  Contested: "contested",
  Storm: "storm",
});

export const DEFAULT_MISSION_PARAMS = Object.freeze({
  /** Alert above which a quiet way in is barred from the inside. */
  vectorCloseAlert: 0.55,
  /** ...and below which the garrison unbars it again. */
  vectorReopenAlert: 0.2,
  /** Alert above which the keep door is reinforced and has to be forced. */
  keepLockAlert: 0.7,
  rescueRadius: 1.6,
  escortRadius: 6,
  /** Contact damage per second, per alerted guard within reach. */
  engagePressure: 9,
  engageRadius: 1.3,
  /** Out of contact in the open ground, a party puts itself back together. */
  recoverPerSecond: 4,
  regroupSeconds: 6,
  regroupHealthFraction: 0.6,
  princessSpeed: 2.2,
  /** Bringing masonry down is slow and extremely loud. */
  breachSeconds: 6,
  breachNoise: 0.9,
  /** Forcing a door that has been barred: slower still, and just as loud. */
  forceSeconds: 9,
  forceNoise: 0.7,
  /** A sergeant will not take money once the alarm has gone up. */
  bribeMaxAlert: 0.35,
  bribeSeconds: 2,
  /** Storm scaling: relief columns at full alert, versus at none. */
  reliefSquadAtCalm: 3,
  reliefSquadAtAlert: 7,
  reliefCooldownAtCalm: 30,
  reliefCooldownAtAlert: 12,
  stealthCeiling: 0.35,
  stormFloor: 0.75,
});

export function makeMissionParams(overrides = {}) {
  return { ...DEFAULT_MISSION_PARAMS, ...overrides };
}

/**
 * The princess. She is a rescue objective, then she is a straggler you have to
 * get home — she follows whoever came for her rather than pathing herself.
 */
export class Captive {
  constructor({ position, bodyRadius = 0.25 }) {
    this.position = clone(position);
    this.velocity = vec2();
    this.bodyRadius = bodyRadius;
    this.rescued = false;
    this.isAlive = true;
  }
}

export class CastleMission {
  constructor({ castle, garrison, party = [], params = {} }) {
    this.castle = castle;
    this.garrison = garrison;
    this.party = party;
    this.params = makeMissionParams(params);

    this.princess = new Captive({
      position: castle.map.gridToWorldCenter(castle.princess.x, castle.princess.y),
    });
    this.rally = castle.map.gridToWorldCenter(castle.landmarks.rally.x, castle.landmarks.rally.y);

    this.phase = MissionPhase.Infiltrate;
    this.elapsed = 0;
    this.attempts = 1;
    this.peakAlert = 0;
    this.regroupTimer = 0;
    this.events = [];
    /** Vector id to the action being carried out on it, if any. */
    this.actions = new Map();
    /** Which vector the party actually came in by, once one has been used. */
    this.entryUsed = null;
    /** Tile key to edge id, so a crossing is noticed by being walked on. */
    this.crossingTiles = new Map();

    for (const edge of castle.edges) {
      for (const tile of edge.tiles) {
        this.crossingTiles.set(`${tile.x},${tile.y}`, edge.id);
      }
    }
  }

  get alertLevel() {
    return this.garrison.alertLevel;
  }

  get survivors() {
    return this.party.filter((member) => member.isAlive !== false);
  }

  get isComplete() {
    return this.phase === MissionPhase.Complete;
  }

  /** Stealth, contested or storm — decided by the worst it ever got. */
  get style() {
    if (this.peakAlert <= this.params.stealthCeiling) {
      return ApproachStyle.Stealth;
    }

    return this.peakAlert >= this.params.stormFloor ? ApproachStyle.Storm : ApproachStyle.Contested;
  }

  log(type, detail = {}) {
    this.events.push({ at: Number(this.elapsed.toFixed(2)), type, detail });

    if (this.events.length > 64) {
      this.events.shift();
    }
  }

  tick(dt) {
    this.elapsed += dt;

    if (this.phase === MissionPhase.Regrouping) {
      this.tickRegroup(dt);
      return;
    }

    const seen = this.survivors;

    this.garrison.tick(dt, this.princess.rescued ? [...seen, this.princess] : seen);
    this.peakAlert = Math.max(this.peakAlert, this.alertLevel);

    this.tickActions(dt);
    this.tickSchedules();
    this.tickAlertResponse();
    this.tickEngagement(dt);
    this.tickEntry();
    this.tickPrincess(dt);
    this.tickObjective();
  }

  /**
   * Timed actions on a vector — bringing a wall down, buying a sergeant.
   *
   * Both need the actor to stay put next to the thing, which is what makes a
   * loud entry a commitment rather than a button.
   */
  tickActions(dt) {
    for (const [edgeId, action] of [...this.actions]) {
      const edge = this.castle.edges.find((candidate) => candidate.id === edgeId);

      if (!edge || action.actor.isAlive === false) {
        this.actions.delete(edgeId);
        continue;
      }

      if (distance(action.actor.position, this.worldOf(edge.location)) > 2.5) {
        this.actions.delete(edgeId);
        this.log("action-abandoned", { edge: edgeId, kind: action.kind });
        continue;
      }

      action.remaining -= dt;

      if (action.remaining <= 0) {
        this.actions.delete(edgeId);
        this.completeAction(edge, action);
      }
    }
  }

  completeAction(edge, action) {
    this.openTiles(edge);
    edge.isOpen = true;
    edge.barredByAlert = false;
    this.log(`${action.kind}-opened`, { edge: edge.id, at: edge.location });

    if (action.kind === "breach") {
      // Masonry coming down is the loudest thing that happens in this level.
      this.garrison.disturb(this.worldOf(edge.location), this.params.breachNoise, 20);
    } else if (action.kind === "force") {
      this.garrison.disturb(this.worldOf(edge.location), this.params.forceNoise, 16);
    }
  }

  /** The delivery door runs to a timetable, whatever else is going on. */
  tickSchedules() {
    for (const edge of this.castle.edges) {
      if (!edge.isActive || !edge.schedule || edge.barredByAlert) {
        continue;
      }

      const { openFor, period, phase } = edge.schedule;
      const shouldBeOpen = (this.elapsed + phase) % period < openFor;

      if (shouldBeOpen !== edge.isOpen) {
        edge.isOpen = shouldBeOpen;

        if (shouldBeOpen) {
          this.openTiles(edge);
        } else if (!this.someoneStandingIn(edge)) {
          this.closeTiles(edge);
        } else {
          // Someone is in the doorway; the carters cannot shut it on them.
          edge.isOpen = true;
        }
      }
    }
  }

  /**
   * What the alert costs you.
   *
   * Quiet ways in get barred, the keep is shut up, and the garrison's response
   * scales — all of it reversible on the way back down, except that a door
   * standing open because somebody is in it cannot be barred at all.
   */
  tickAlertResponse() {
    const alert = this.alertLevel;

    for (const edge of this.castle.activeVectors()) {
      if (edge.traversalType !== TraversalType.Stealth) {
        continue;
      }

      const closeAt = this.params.vectorCloseAlert * (1.3 - 0.3 * edge.alertSensitivity);

      if (alert >= closeAt && edge.isOpen && !this.someoneStandingIn(edge)) {
        edge.isOpen = false;
        edge.barredByAlert = true;
        this.closeTiles(edge);
        this.log("vector-barred", { edge: edge.id, vectorType: edge.vectorType, alert });
      } else if (alert <= this.params.vectorReopenAlert && edge.barredByAlert) {
        edge.isOpen = true;
        edge.barredByAlert = false;
        this.openTiles(edge);
        this.log("vector-reopened", { edge: edge.id, vectorType: edge.vectorType });
      }
    }

    const keepGate = this.castle.edges.find(
      (edge) => edge.vectorType === VectorType.Gate && edge.toWard === WardId.Keep,
    );

    if (keepGate) {
      if (alert >= this.params.keepLockAlert && keepGate.isOpen && !this.someoneStandingIn(keepGate)) {
        keepGate.isOpen = false;
        keepGate.barredByAlert = true;
        this.closeTiles(keepGate);
        this.log("keep-sealed", { alert });
      } else if (alert <= this.params.vectorReopenAlert && keepGate.barredByAlert) {
        keepGate.isOpen = true;
        keepGate.barredByAlert = false;
        this.openTiles(keepGate);
        this.log("keep-unsealed", {});
      }
    }

    // Storm scaling: at full alert the castle sends more men, sooner.
    const p = this.params;
    this.garrison.params.reinforcementSquad = Math.round(
      p.reliefSquadAtCalm + (p.reliefSquadAtAlert - p.reliefSquadAtCalm) * alert,
    );
    this.garrison.params.reinforcementCooldown =
      p.reliefCooldownAtCalm + (p.reliefCooldownAtAlert - p.reliefCooldownAtCalm) * alert;
  }

  /**
   * Contact. There is no combat model in this project yet, so an alerted guard
   * within arm's reach simply wears a party member down — enough to make being
   * caught matter, and deliberately not enough to be mistaken for a fight.
   */
  tickEngagement(dt) {
    for (const guard of this.garrison.guards) {
      if (guard.alert !== AlertState.Alerted && guard.stance !== GuardStance.Reinforce) {
        continue;
      }

      for (const member of this.survivors) {
        if (distance(guard.position, member.position) <= this.params.engageRadius) {
          member.applyDamage?.(this.params.engagePressure * dt);
        }
      }
    }

    // Out of contact, in the open, a party patches itself up.
    const calm = this.garrison.elapsed - this.garrison.lastContact > this.garrison.params.calmSeconds;

    if (calm) {
      for (const member of this.survivors) {
        if (member.maxHealth && this.wardTypeOf(member.position) === WardType.Approach) {
          member.health = Math.min(member.maxHealth, member.health + this.params.recoverPerSecond * dt);
        }
      }
    }

    if (this.survivors.length === 0) {
      this.beginRegroup();
    }
  }

  /** Once rescued, the princess trails whoever is nearest and keeps up. */
  tickPrincess(dt) {
    if (!this.princess.rescued) {
      return;
    }

    const escort = this.nearestMember(this.princess.position);
    if (!escort) {
      this.princess.velocity = vec2();
      return;
    }

    if (distance(this.princess.position, escort.position) > 1.1) {
      stepToward(this.princess, escort.position, this.params.princessSpeed, dt, this.castle.map);
    } else {
      this.princess.velocity = vec2();
    }
  }

  tickObjective() {
    if (!this.princess.rescued) {
      const rescuer = this.survivors.find(
        (member) => distance(member.position, this.princess.position) <= this.params.rescueRadius,
      );

      if (rescuer) {
        this.princess.rescued = true;
        this.phase = MissionPhase.Extract;
        this.log("rescued", { by: rescuer.id ?? null, style: this.style, alert: this.alertLevel });
      }

      return;
    }

    const escorted = this.survivors.some(
      (member) => distance(member.position, this.princess.position) <= this.params.escortRadius,
    );

    if (escorted && this.isAtExtraction(this.princess.position)) {
      this.phase = MissionPhase.Complete;
      this.log("extracted", { attempts: this.attempts, style: this.style, peakAlert: this.peakAlert });
    }
  }

  /**
   * Away is the buffer: past the apron, out in the country the garrison
   * neither walks nor can see across.
   *
   * The same band the party formed up in, which is the point — getting out is
   * getting back to where you started, and the run is bracketed by the one
   * piece of ground nobody is watching.
   */
  isAtExtraction(point) {
    const cell = this.castle.map.worldToGrid(point);
    const ward = this.castle.wardAt(cell.x, cell.y);

    if (!ward || ward.type !== WardType.Approach) {
      return false;
    }

    return isBufferGround(this.castle.landmarks.apron, cell.x, cell.y);
  }

  /**
   * The party is beaten. It is not over: they fall back, patch up, and the
   * castle stays awake — the next attempt starts against a garrison that
   * already knows someone is out there.
   */
  beginRegroup() {
    if (this.phase === MissionPhase.Regrouping) {
      return;
    }

    this.phase = MissionPhase.Regrouping;
    this.regroupTimer = this.params.regroupSeconds;
    this.princess.rescued = false;
    this.princess.position = this.castle.map.gridToWorldCenter(
      this.castle.princess.x,
      this.castle.princess.y,
    );
    this.log("repulsed", { attempt: this.attempts, alert: this.alertLevel });
  }

  tickRegroup(dt) {
    this.regroupTimer -= dt;
    // The garrison keeps working while the party is away — the alarm cools at
    // its own pace, so coming straight back is a choice with a cost.
    this.garrison.tick(dt, []);

    if (this.regroupTimer > 0) {
      return;
    }

    this.attempts += 1;
    this.phase = MissionPhase.Infiltrate;

    this.party.forEach((member, index) => {
      member.health = Math.max(
        1,
        Math.round((member.maxHealth ?? 100) * this.params.regroupHealthFraction),
      );
      member.state = AgentState.Moving;
      member.velocity = vec2();
      member.position = {
        x: this.rally.x + (index % 3) * 0.8 - 0.8,
        y: this.rally.y + Math.floor(index / 3) * 0.8,
      };
    });

    this.log("regrouped", { attempt: this.attempts, alert: this.alertLevel });
  }

  /**
   * A party action on a vector: bring the masonry down, or buy the sergeant.
   *
   * @returns {{ok: boolean, reason?: string}}
   */
  interact(edgeId, actor) {
    const edge = this.castle.edges.find((candidate) => candidate.id === edgeId);

    if (!edge || !edge.isActive) {
      return { ok: false, reason: "no such vector" };
    }

    if (edge.isOpen) {
      return { ok: false, reason: "already open" };
    }

    if (distance(actor.position, this.worldOf(edge.location)) > 2.5) {
      return { ok: false, reason: "too far away" };
    }

    if (this.actions.has(edge.id)) {
      return { ok: false, reason: "already under way" };
    }

    if (edge.vectorType === VectorType.Breach) {
      this.actions.set(edge.id, { kind: "breach", actor, remaining: this.params.breachSeconds });
      this.log("breach-started", { edge: edge.id });
      return { ok: true };
    }

    if (edge.vectorType === VectorType.Bribe) {
      if (this.alertLevel > this.params.bribeMaxAlert) {
        return { ok: false, reason: "he will not take it now" };
      }

      this.actions.set(edge.id, { kind: "bribe", actor, remaining: this.params.bribeSeconds });
      this.log("bribe-started", { edge: edge.id });
      return { ok: true };
    }

    // Anything else that is shut — a barred postern, a delivery door between
    // runs, a keep sealed by the alarm — can be forced. Slowly, and loudly.
    // This is what keeps the storm path open against a castle that has woken
    // up: the way in never disappears, it only gets more expensive.
    this.actions.set(edge.id, { kind: "force", actor, remaining: this.params.forceSeconds });
    this.log("force-started", { edge: edge.id, vectorType: edge.vectorType });
    return { ok: true };
  }

  /**
   * Notices which way the party came in, by watching what they stand on.
   *
   * The level does not need to be told which plan was chosen: whichever
   * crossing somebody walks through first is the answer.
   */
  tickEntry() {
    if (this.entryUsed) {
      return;
    }

    for (const member of this.survivors) {
      const cell = this.castle.map.worldToGrid(member.position);
      const edgeId = this.crossingTiles.get(`${cell.x},${cell.y}`);

      if (!edgeId) {
        continue;
      }

      const edge = this.castle.edges.find((candidate) => candidate.id === edgeId);
      this.entryUsed = edgeId;
      this.log("entered", { edge: edgeId, vectorType: edge?.vectorType ?? null });
      return;
    }
  }

  openTiles(edge) {
    for (const tile of edge.tiles) {
      this.castle.map.set(tile.x, tile.y, CastleTile.Floor);
    }
  }

  closeTiles(edge) {
    for (const tile of edge.tiles) {
      this.castle.map.set(tile.x, tile.y, CastleTile.Door);
    }
  }

  /**
   * A door cannot be shut on someone standing in it.
   *
   * The party only. The castle's own sentries pace over their doorways all the
   * time, and a garrison is perfectly capable of stepping aside to drop a bar —
   * so counting them here would mean a guarded door could never be shut at all.
   * Standing in the doorway is a move the *player* has.
   */
  someoneStandingIn(edge) {
    const occupants = [...this.survivors, this.princess];

    return edge.tiles.some((tile) =>
      occupants.some((occupant) => {
        const cell = this.castle.map.worldToGrid(occupant.position);
        return cell.x === tile.x && cell.y === tile.y;
      }),
    );
  }

  nearestMember(point) {
    let best = null;
    let bestDistance = Infinity;

    for (const member of this.survivors) {
      const separation = distance(point, member.position);

      if (separation < bestDistance) {
        bestDistance = separation;
        best = member;
      }
    }

    return best;
  }

  wardTypeOf(point) {
    return this.castle.wardAtWorld(point)?.type ?? null;
  }

  worldOf(cell) {
    return this.castle.map.gridToWorldCenter(cell.x, cell.y);
  }

  /** Everything a UI or a test wants to read, in one object. */
  snapshot() {
    return {
      phase: this.phase,
      style: this.style,
      elapsed: Number(this.elapsed.toFixed(1)),
      attempts: this.attempts,
      alert: this.alertLevel,
      peakAlert: this.peakAlert,
      rescued: this.princess.rescued,
      survivors: this.survivors.length,
      partySize: this.party.length,
      entryUsed: this.entryUsed,
      openVectors: this.castle
        .activeVectors()
        .filter((edge) => edge.isPassable)
        .map((edge) => edge.vectorType),
      garrison: this.garrison.snapshot(),
    };
  }
}
