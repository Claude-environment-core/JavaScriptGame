/**
 * The garrison: who is watching, what they have noticed, and what the castle
 * does about it.
 *
 * Difficulty here comes from behaviour, not from geometry. The walls do not
 * get thicker when the player is good at the game; the garrison reacts faster,
 * from further away, and in greater numbers. That reaction is a chain the
 * player can learn and interrupt at any link:
 *
 *   guard sees something  →  guard shouts, and the men who hear him look
 *                         →  enough alerted men raise the ward's alarm
 *                         →  the alarm spreads to adjacent wards
 *                         →  the wards behind it send a squad
 *
 * Every link decays. A guard who loses contact stops being sure; a ward with
 * nobody shouting stands down; a squad that finds nothing goes back on patrol.
 *
 * Guards route with the project's A*, and reinforcement squads march under the
 * formation controller from `src/sim/formation` — the same deformable virtual
 * structure the player's own squad uses, so a relief column coming through a
 * gate behaves the way the player's squad does coming the other way.
 */

import { Agent, AgentRole, AgentState } from "../sim/agent.js";
import { FormationType } from "../sim/formation/shape.js";
import { hasLineOfSight } from "../sim/gridMap.js";
import { createSquadController } from "../sim/squad.js";
import { clone, distance, normalize, vec2 } from "../sim/vec2.js";
import { PathFollower, routeTo, stepToward } from "./patrol.js";
import { WardType } from "./wards.js";

/** What a guard currently believes. */
export const AlertState = Object.freeze({
  Unaware: "unaware",
  Suspicious: "suspicious",
  Alerted: "alerted",
});

/** What a guard is currently doing about it. */
export const GuardStance = Object.freeze({
  Patrol: "patrol",
  Investigate: "investigate",
  Pursue: "pursue",
  Reinforce: "reinforce",
  Return: "return",
});

export const DEFAULT_GARRISON_PARAMS = Object.freeze({
  /** Sight, in tiles. Tower watch sees further because it stands higher. */
  visionRange: 9.5,
  towerVisionRange: 17,
  fieldOfView: (Math.PI * 2) / 3,
  /** A guard who has heard nothing walks; a guard who has walks fast. */
  patrolSpeed: 1.5,
  alertSpeed: 2.8,
  /** Shouting carries through walls, unlike sight. */
  shoutRadius: 8,
  suspicionRise: 0.95,
  suspicionFall: 0.3,
  suspiciousAt: 0.45,
  alertedAt: 1,
  alarmRise: 0.75,
  alarmFall: 0.11,
  alarmThreshold: 0.6,
  /** Alarm bleeding into the wards next door, as a fraction of the source. */
  alarmSpread: 0.45,
  reinforcementDelay: 3,
  reinforcementSquad: 4,
  reinforcementCooldown: 25,
  /** A relief column that has not arrived by now gives up and walks back. */
  reinforcementTimeout: 90,
  investigateSeconds: 5,
  calmSeconds: 6,
  garrisonScale: 1,
  maxGuardsPerWard: 14,
  eventLogLimit: 64,
});

export function makeGarrisonParams(overrides = {}) {
  return { ...DEFAULT_GARRISON_PARAMS, ...overrides };
}

/**
 * A member of the garrison.
 *
 * Extends the project's {@link Agent}, so a guard can be handed straight to
 * the formation controller when it is pulled into a relief column.
 */
export class Guard extends Agent {
  constructor({
    id,
    position,
    wardId,
    route = null,
    routeIndex = 0,
    visionRange = DEFAULT_GARRISON_PARAMS.visionRange,
    sensitivity = 1,
    role = AgentRole.Rifleman,
    isSentry = false,
    facing = vec2(1, 0),
  }) {
    super({ id, position, role, state: AgentState.Moving });

    this.wardId = wardId;
    /** Where this guard belongs when there is nothing happening. */
    this.homeWardId = wardId;
    this.route = route;
    this.follower = new PathFollower({
      waypoints: route ? route.waypoints : [],
      loop: true,
      index: routeIndex,
    });
    this.visionRange = visionRange;
    this.sensitivity = sensitivity;
    this.isSentry = isSentry;
    this.facing = clone(facing);

    this.suspicion = 0;
    this.alert = AlertState.Unaware;
    this.stance = GuardStance.Patrol;
    /** Last place this guard has reason to think an intruder was. */
    this.lastKnown = null;
    this.investigateTimer = 0;
    this.squadId = null;
    this.detour = new PathFollower();
    /** Set while walking back to the ward this guard belongs to. */
    this.returnTarget = null;
  }

  get isBusy() {
    return this.stance !== GuardStance.Patrol;
  }
}

/** True when `point` is inside a guard's cone of vision and not behind a wall. */
export function canSee(guard, point, map, { fieldOfView = DEFAULT_GARRISON_PARAMS.fieldOfView } = {}) {
  const separation = distance(guard.position, point);

  if (separation > guard.visionRange) {
    return false;
  }

  // Anything close enough to touch is noticed regardless of facing.
  if (separation > 1.2) {
    const toTarget = normalize({ x: point.x - guard.position.x, y: point.y - guard.position.y });
    const dot = toTarget.x * guard.facing.x + toTarget.y * guard.facing.y;

    if (dot < Math.cos(fieldOfView / 2)) {
      return false;
    }
  }

  return hasLineOfSight(map, guard.position, point);
}

/**
 * The castle's garrison and its alert state.
 */
export class Garrison {
  constructor({ castle, params = {}, random = null }) {
    this.castle = castle;
    this.params = makeGarrisonParams(params);
    this.random = random;
    this.guards = [];
    /** Ward id to alarm level in `[0, 1]`. */
    this.alarms = new Map(castle.wardList.map((ward) => [ward.id, 0]));
    this.alarmed = new Set();
    this.squads = [];
    this.pending = [];
    this.cooldowns = new Map();
    this.events = [];
    this.elapsed = 0;
    this.lastContact = -Infinity;
    this.reinforcementsSent = 0;
    this.sightings = 0;
  }

  /**
   * Castle-wide alert: half the worst ward, half a depth-weighted average.
   *
   * Both halves are needed. Without the worst-ward term a real alarm in one
   * place reads as a calm castle; without the weighted term a scuffle out in
   * the field reads the same as men fighting in the keep, and the deeper the
   * trouble is, the more the castle should care.
   */
  get alertLevel() {
    let worst = 0;
    let weighted = 0;
    let total = 0;

    for (const ward of this.castle.wardList) {
      const level = this.alarms.get(ward.id) ?? 0;
      const weight = 1 + ward.depth * 0.4;

      worst = Math.max(worst, level);
      weighted += level * weight;
      total += weight;
    }

    if (total === 0) {
      return 0;
    }

    return Math.min(1, worst * 0.5 + (weighted / total) * 0.5);
  }

  get isAlarmed() {
    return this.alarmed.size > 0;
  }

  alarmIn(wardId) {
    return this.alarms.get(wardId) ?? 0;
  }

  guardsIn(wardId) {
    return this.guards.filter((guard) => guard.wardId === wardId);
  }

  log(type, detail = {}) {
    // Detail is nested, not spread: an event about a place has an `at` of its
    // own, and it must not overwrite the timestamp.
    this.events.push({ at: Number(this.elapsed.toFixed(2)), type, detail });

    if (this.events.length > this.params.eventLogLimit) {
      this.events.shift();
    }
  }

  /**
   * One step of the whole chain: see, shout, raise, spread, reinforce, decay.
   */
  tick(dt, intruders = []) {
    this.elapsed += dt;

    const visible = intruders.filter((intruder) => intruder && intruder.isAlive !== false);
    const contacts = this.sense(dt, visible);
    this.think(dt);
    this.move(dt);
    this.raiseAlarms(dt, contacts);
    this.runReinforcements(dt);

    return contacts;
  }

  /** Detection. Suspicion rises with exposure and falls when contact is lost. */
  sense(dt, intruders) {
    const contacts = [];

    for (const guard of this.guards) {
      let seen = null;
      let closest = Infinity;

      for (const intruder of intruders) {
        const separation = distance(guard.position, intruder.position);

        if (separation < closest && canSee(guard, intruder.position, this.castle.map, this.params)) {
          closest = separation;
          seen = intruder;
        }
      }

      if (seen) {
        const exposure = 1 - Math.min(1, closest / Math.max(1e-6, guard.visionRange));
        guard.suspicion += this.params.suspicionRise * guard.sensitivity * (0.35 + 0.65 * exposure) * dt;
        guard.lastKnown = clone(seen.position);
        this.lastContact = this.elapsed;
        contacts.push({ guard, intruder: seen, distance: closest });
      } else {
        guard.suspicion = Math.max(0, guard.suspicion - this.params.suspicionFall * dt);
      }

      this.updateGuardAlert(guard);
    }

    return contacts;
  }

  /** Promotes and demotes a guard's belief, and shouts on the way up. */
  updateGuardAlert(guard) {
    const previous = guard.alert;

    if (guard.suspicion >= this.params.alertedAt) {
      guard.alert = AlertState.Alerted;
    } else if (guard.suspicion >= this.params.suspiciousAt) {
      guard.alert = AlertState.Suspicious;
    } else {
      guard.alert = AlertState.Unaware;
    }

    if (guard.alert === AlertState.Alerted && previous !== AlertState.Alerted) {
      this.sightings += 1;
      this.log("sighting", { guard: guard.id, ward: guard.wardId, at: guard.lastKnown });
      this.shout(guard);
    }
  }

  /**
   * A shout carries to everyone in earshot, walls included — which is how an
   * alarm crosses a ward boundary before any alarm bell is rung.
   */
  shout(source) {
    for (const guard of this.guards) {
      if (guard === source || guard.alert === AlertState.Alerted) {
        continue;
      }

      if (distance(guard.position, source.position) > this.params.shoutRadius) {
        continue;
      }

      guard.suspicion = Math.max(guard.suspicion, this.params.suspiciousAt + 0.05);
      guard.lastKnown = source.lastKnown ? clone(source.lastKnown) : clone(source.position);
    }
  }

  /**
   * A noise: masonry coming down, a door forced, a fight.
   *
   * Sound is not sight — it needs no line of sight and no facing — so this is
   * how a loud way in gets the garrison moving without anyone having seen the
   * party at all.
   */
  disturb(point, amount = 0.6, radius = 14) {
    for (const guard of this.guards) {
      const separation = distance(guard.position, point);

      if (separation > radius) {
        continue;
      }

      const falloff = 1 - separation / radius;
      guard.suspicion += amount * falloff;
      guard.lastKnown = clone(point);
      this.updateGuardAlert(guard);
    }

    const ward = this.castle.wardAtWorld(point);
    if (ward) {
      const level = Math.min(1, (this.alarms.get(ward.id) ?? 0) + amount * 0.5);
      this.alarms.set(ward.id, level);
    }

    this.lastContact = this.elapsed;
    this.log("noise", { at: point, amount: Number(amount.toFixed(2)) });
  }

  /** Stance follows belief: patrol, go and look, or run at it. */
  think(dt) {
    for (const guard of this.guards) {
      if (guard.squadId !== null) {
        guard.stance = GuardStance.Reinforce;
        continue;
      }

      switch (guard.alert) {
        case AlertState.Alerted:
          if (guard.stance !== GuardStance.Pursue) {
            guard.stance = GuardStance.Pursue;
            guard.detour.reset([]);
          }
          break;

        case AlertState.Suspicious:
          if (guard.stance === GuardStance.Patrol) {
            guard.stance = GuardStance.Investigate;
            guard.investigateTimer = this.params.investigateSeconds;
            guard.detour.reset([]);
          }
          break;

        default:
          if (guard.stance === GuardStance.Return) {
            break;
          }

          if (guard.stance !== GuardStance.Patrol) {
            guard.investigateTimer -= dt;

            if (guard.investigateTimer <= 0) {
              guard.lastKnown = null;
              guard.detour.reset([]);
              this.standDown(guard);
            }
          }
      }
    }
  }

  /**
   * A guard with nothing left to investigate goes back to his own ward.
   *
   * Without this the castle bleeds: every relief column that marches out to a
   * noise leaves men where the noise was, and a few alarms later the keep is
   * being held by nobody.
   */
  standDown(guard) {
    if (guard.wardId === guard.homeWardId) {
      guard.stance = GuardStance.Patrol;
      return;
    }

    const home = this.castle.ward(guard.homeWardId);
    const circuit = (home?.patrolRoutes ?? []).find((route) => route.waypoints.length > 0);

    guard.returnTarget = circuit
      ? clone(circuit.waypoints[0])
      : this.castle.map.gridToWorldCenter(home?.centroid.x ?? 1, home?.centroid.y ?? 1);
    guard.stance = GuardStance.Return;
    guard.detour.reset(routeTo(this.castle.map, guard.position, guard.returnTarget));
  }

  /** Walks a guard back to his own ward and puts him on a beat there. */
  returnTargetFor(guard) {
    const goal = guard.returnTarget;

    if (!goal || distance(guard.position, goal) < 1.4) {
      guard.wardId = guard.homeWardId;
      guard.stance = GuardStance.Patrol;
      guard.returnTarget = null;
      guard.detour.reset([]);

      const routes = (this.castle.ward(guard.homeWardId)?.patrolRoutes ?? []).filter(
        (route) => route.waypoints.length > 0,
      );

      if (routes.length > 0) {
        guard.route = routes[0];
        guard.follower.reset(guard.route.waypoints, { loop: true });
      }

      return null;
    }

    const next = guard.detour.update(guard.position);
    if (next) {
      return next;
    }

    guard.detour.reset(routeTo(this.castle.map, guard.position, goal));

    // No way home right now — stand and watch rather than walk into a wall.
    if (guard.detour.waypoints.length === 0) {
      guard.stance = GuardStance.Patrol;
      guard.wardId = guard.homeWardId;
    }

    return guard.detour.target;
  }

  /** Movement. Squads are driven by the formation controller, not from here. */
  move(dt) {
    for (const guard of this.guards) {
      if (guard.squadId !== null) {
        this.faceMotion(guard);
        continue;
      }

      let target;

      if (guard.stance === GuardStance.Patrol) {
        target = this.patrolTarget(guard);
      } else if (guard.stance === GuardStance.Return) {
        target = this.returnTargetFor(guard);
      } else {
        target = this.searchTarget(guard);
      }

      if (!target) {
        guard.velocity = vec2();
        continue;
      }

      const alerted = guard.stance === GuardStance.Investigate || guard.stance === GuardStance.Pursue;
      const speed = alerted ? this.params.alertSpeed : this.params.patrolSpeed;
      stepToward(guard, target, speed, dt, this.castle.map);
      this.faceMotion(guard);
    }
  }

  faceMotion(guard) {
    const speed = Math.hypot(guard.velocity.x, guard.velocity.y);

    if (speed > 1e-3) {
      guard.facing = normalize(guard.velocity);
    }
  }

  patrolTarget(guard) {
    if (guard.follower.waypoints.length === 0) {
      return null;
    }

    return guard.follower.update(guard.position);
  }

  /**
   * Where a guard goes to look. The route is planned on the real map, so an
   * investigating guard will use a gate — including one it is not normally
   * posted at.
   */
  searchTarget(guard) {
    const goal = guard.lastKnown;

    if (!goal) {
      return null;
    }

    if (distance(guard.position, goal) < 1.2) {
      guard.investigateTimer = Math.min(guard.investigateTimer, this.params.investigateSeconds);
      return null;
    }

    const next = guard.detour.update(guard.position);
    if (next) {
      return next;
    }

    guard.detour.reset(routeTo(this.castle.map, guard.position, goal));
    return guard.detour.target;
  }

  /**
   * Ward alarms. A single jumpy guard is not an alarm; a third of a ward's
   * strength shouting at once is.
   */
  raiseAlarms(dt, contacts) {
    const calm = this.elapsed - this.lastContact > this.params.calmSeconds;

    for (const ward of this.castle.wardList) {
      const guards = this.guardsIn(ward.id);
      const alerted = guards.filter((guard) => guard.alert === AlertState.Alerted).length;
      const quorum = Math.max(1, Math.ceil(guards.length / 3));
      let level = this.alarms.get(ward.id) ?? 0;

      if (alerted > 0) {
        const pressure = Math.min(1, alerted / quorum) * ward.alertSensitivity;
        level = Math.min(1, level + this.params.alarmRise * pressure * dt);
      } else if (calm) {
        level = Math.max(0, level - this.params.alarmFall * dt);
      }

      this.alarms.set(ward.id, level);

      if (level >= this.params.alarmThreshold && !this.alarmed.has(ward.id)) {
        this.onWardAlarm(ward, contacts);
      } else if (level < this.params.alarmThreshold * 0.5 && this.alarmed.has(ward.id)) {
        this.alarmed.delete(ward.id);
        this.log("stand-down", { ward: ward.id });
      }
    }
  }

  /** A ward goes loud: it tells its neighbours, and it calls for help. */
  onWardAlarm(ward, contacts) {
    this.alarmed.add(ward.id);

    const contact = contacts.find((entry) => entry.guard.wardId === ward.id);
    const point = contact
      ? clone(contact.intruder.position)
      : (this.guardsIn(ward.id).find((guard) => guard.lastKnown)?.lastKnown ??
        this.castle.map.gridToWorldCenter(ward.centroid.x, ward.centroid.y));

    this.log("alarm", { ward: ward.id, type: ward.type, at: point });

    // Neighbouring wards hear the bell even if they have seen nothing.
    for (const neighborId of this.castle.neighbors(ward.id, { openOnly: false })) {
      const current = this.alarms.get(neighborId) ?? 0;
      this.alarms.set(neighborId, Math.max(current, this.alarms.get(ward.id) * this.params.alarmSpread));
    }

    const readyAt = this.cooldowns.get(ward.id) ?? -Infinity;
    if (this.elapsed >= readyAt) {
      this.cooldowns.set(ward.id, this.elapsed + this.params.reinforcementCooldown);
      this.pending.push({ wardId: ward.id, point, at: this.elapsed + this.params.reinforcementDelay });
    }
  }

  /** Dispatches queued relief columns, then ticks the ones already marching. */
  runReinforcements(dt) {
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      if (this.elapsed >= this.pending[i].at) {
        const request = this.pending.splice(i, 1)[0];
        this.dispatch(request.wardId, request.point);
      }
    }

    for (let i = this.squads.length - 1; i >= 0; i -= 1) {
      const squad = this.squads[i];
      squad.controller.tick(dt);
      squad.elapsed += dt;

      const arrived = squad.controller.hasArrived();
      if (arrived || squad.elapsed > this.params.reinforcementTimeout) {
        this.disband(squad, arrived);
        this.squads.splice(i, 1);
      }
    }
  }

  /**
   * Sends men from the wards behind the alarm.
   *
   * Reinforcements come from deeper wards, never from the open ground outside,
   * and a ward never sends more than half its strength: stripping the keep to
   * chase a noise in the outer bailey is exactly the mistake a castle is built
   * not to make.
   */
  dispatch(wardId, point) {
    const alarmed = this.castle.ward(wardId);
    if (!alarmed) {
      return;
    }

    for (const neighborId of this.castle.neighbors(wardId, { openOnly: true })) {
      const neighbor = this.castle.ward(neighborId);

      if (!neighbor || neighbor.depth <= alarmed.depth) {
        continue;
      }

      const available = this.guardsIn(neighborId).filter(
        (guard) => guard.squadId === null && !guard.isSentry,
      );
      const spare = Math.min(
        this.params.reinforcementSquad,
        Math.floor(this.guardsIn(neighborId).length / 2),
        available.length,
      );

      if (spare < 1) {
        continue;
      }

      const column = available
        .slice()
        .sort((a, b) => distance(a.position, point) - distance(b.position, point))
        .slice(0, spare);

      const controller = createSquadController({
        agents: column,
        map: this.castle.map,
        goal: point,
        formation: column.length >= 3 ? FormationType.Wedge : FormationType.Column,
      });

      if (!controller) {
        continue;
      }

      const id = `relief-${this.reinforcementsSent}`;
      for (const guard of column) {
        guard.squadId = id;
        guard.stance = GuardStance.Reinforce;
        guard.lastKnown = clone(point);
      }

      this.squads.push({
        id,
        controller,
        guards: column,
        fromWard: neighborId,
        toWard: wardId,
        goal: clone(point),
        elapsed: 0,
      });

      this.reinforcementsSent += 1;
      this.log("reinforce", { from: neighborId, to: wardId, count: column.length, at: point });
    }
  }

  /** A column that has arrived becomes patrolling guards of the ward it is in. */
  disband(squad, arrived) {
    for (const guard of squad.guards) {
      guard.squadId = null;
      guard.velocity = vec2();

      const ward = this.castle.wardAtWorld(guard.position);
      guard.wardId = ward ? ward.id : guard.homeWardId;

      // Joins whichever circuit in the ward starts closest: a man who has been
      // marched somewhere else picks up the nearest beat, not his old one.
      const routes = (this.castle.ward(guard.wardId)?.patrolRoutes ?? []).filter(
        (route) => route.kind === "circuit" && route.waypoints.length > 0,
      );

      if (routes.length > 0) {
        guard.route = routes.reduce((best, route) =>
          distance(guard.position, route.waypoints[0]) < distance(guard.position, best.waypoints[0])
            ? route
            : best,
        );
        guard.follower.reset(guard.route.waypoints, { loop: true });
      }

      if (arrived) {
        guard.stance = GuardStance.Investigate;
        guard.investigateTimer = this.params.investigateSeconds;
        guard.lastKnown = clone(squad.goal);
      } else {
        guard.lastKnown = null;
        this.standDown(guard);
      }
    }

    this.log("relief-" + (arrived ? "arrived" : "recalled"), { squad: squad.id, ward: squad.toWard });
  }

  /** Everything the debug view needs, without reaching into the guards. */
  snapshot() {
    return {
      alertLevel: this.alertLevel,
      alarms: Object.fromEntries(this.alarms),
      alarmedWards: [...this.alarmed],
      guards: this.guards.length,
      alerted: this.guards.filter((guard) => guard.alert === AlertState.Alerted).length,
      squads: this.squads.length,
      reinforcementsSent: this.reinforcementsSent,
      sightings: this.sightings,
    };
  }
}

/**
 * Mans the castle.
 *
 * Chokepoints are staffed first — that is where a garrison actually stands —
 * then the remainder walk circuits, spread around their routes so a ward is
 * not one clump of men. Tower watch is posted last, and sees furthest.
 */
export function populateGarrison({ castle, random, params = {}, routes = [] }) {
  const merged = makeGarrisonParams(params);
  const garrison = new Garrison({ castle, params: merged, random });
  let counter = 0;

  const spawn = (route, wardId, options = {}) => {
    const index = route.waypoints.length > 0 ? random.nextInt(0, route.waypoints.length) : 0;
    const position = route.waypoints[index] ?? castle.map.gridToWorldCenter(1, 1);

    const guard = new Guard({
      id: `guard-${counter}`,
      position: clone(position),
      wardId,
      route,
      routeIndex: index,
      visionRange: options.visionRange ?? merged.visionRange,
      sensitivity: options.sensitivity ?? castle.ward(wardId)?.alertSensitivity ?? 1,
      role: options.role ?? AgentRole.Rifleman,
      isSentry: options.isSentry ?? false,
    });

    counter += 1;
    garrison.guards.push(guard);
    return guard;
  };

  for (const ward of castle.wardList) {
    const wardRoutes = routes.filter((route) => route.wardId === ward.id);
    const posts = wardRoutes.filter((route) => route.kind === "post");
    const circuits = wardRoutes.filter((route) => route.kind === "circuit");

    // Sentries are posted per chokepoint and are additional to the ward's own
    // strength: a castle with more ways in has more men standing in them,
    // which is what makes an extra live vector cost the garrison something.
    let placed = 0;

    for (const post of posts) {
      const edge = castle.edges.find((candidate) => candidate.id === post.edgeId);

      // The crossing's own density decides this, and it is allowed to round to
      // nobody: no garrison posts a man on a drain, because a drain is not a
      // door. That is precisely what makes the drain worth the crawl.
      const wanted = Math.min(3, Math.round(edge?.garrisonDensity ?? 1));

      for (let i = 0; i < wanted && placed < merged.maxGuardsPerWard; i += 1) {
        spawn(post, ward.id, { isSentry: true });
        placed += 1;
      }
    }

    const patrols = Math.max(1, Math.round(ward.garrisonSize * merged.garrisonScale));

    for (let i = 0; i < patrols && placed < merged.maxGuardsPerWard && circuits.length > 0; i += 1) {
      spawn(circuits[i % circuits.length], ward.id);
      placed += 1;
    }
  }

  // Tower watch: static posts in the open ground, with the longest sightlines
  // in the castle. On a single layer this stands in for the view from the top.
  const approach = castle.wardOfType(WardType.Approach);
  if (approach) {
    for (const [index, tower] of (castle.landmarks.towers ?? []).entries()) {
      const point = castle.map.gridToWorldCenter(tower.post.x, tower.post.y);
      const route = { id: `tower-${index}`, wardId: approach.id, kind: "post", waypoints: [point] };

      spawn(route, approach.id, {
        visionRange: merged.towerVisionRange,
        role: AgentRole.Scout,
        isSentry: true,
      });
    }
  }

  return garrison;
}
