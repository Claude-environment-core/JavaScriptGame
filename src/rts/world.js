import { FACTIONS, RTS_DEFAULTS } from "./config.js";
import { generateStrategicMap } from "./mapGen.js";

/**
 * The RTS world: who owns what, where the armies are, and the rules that move
 * them and make them fight.
 *
 * The rules are deliberately small so that what wins is the strategy, not
 * micro-management:
 *
 * - **Territories pay.** Every region has an income; gold buys new armies, and
 *   income also caps how much army a faction can field, so winning ground is
 *   what lets a faction outgrow its rivals.
 * - **Armies fight where they stand.** Every faction present in a region, plus
 *   the owner's garrison, trades fire each tick. Fire is split across enemies by
 *   their share of the strength present, and the owner shoots harder.
 * - **Taking ground takes time.** An army alone in a region it does not own
 *   captures it after a few uncontested seconds.
 * - **Armies on the march do not fight.** Combat happens at rally points, so a
 *   move is a commitment the enemy can see coming.
 *
 * Nothing here decides anything; orders arrive through {@link RtsWorld#orderArmy}
 * and {@link RtsWorld#recruit}, from whichever commander a faction has.
 */

export const ArmyStatus = Object.freeze({
  IDLE: "idle",
  MARCHING: "marching",
});

/** The side key used for a region nobody has taken yet. */
export const NEUTRAL = "neutral";

export class RtsWorld {
  constructor({ seed = 0, factionCount = FACTIONS.length, params = {} } = {}) {
    this.params = { ...RTS_DEFAULTS, ...params };
    this.seed = seed;
    this.time = 0;
    this.nextArmyId = 1;
    this.events = [];
    this.winner = null;

    const generated = generateStrategicMap({
      width: this.params.width,
      height: this.params.height,
      regionCount: this.params.regionCount,
      blockedShare: this.params.blockedShare,
      factionCount,
      seed,
    });
    this.map = generated.map;
    this.terrain = generated.terrain;
    this.regionOf = generated.regionOf;
    this.routes = generated.routes;

    this.regions = generated.regions.map((region) => ({
      ...region,
      owner: null,
      capitalOf: null,
      garrison: this.params.garrisonBase + region.income,
      captureProgress: 0,
      contested: false,
    }));

    this.factions = FACTIONS.slice(0, factionCount).map((faction, index) => ({
      ...faction,
      capital: generated.capitals[index],
      gold: 0,
      eliminated: false,
    }));

    this.armies = [];
    for (const faction of this.factions) {
      const capital = this.regions[faction.capital];
      capital.owner = faction.id;
      capital.capitalOf = faction.id;
      capital.garrison = this.garrisonCap(capital);
      this.spawnArmy(faction.id, capital.id, this.params.startingStrength);
    }
  }

  garrisonCap(region) {
    return this.params.garrisonBase + region.income;
  }

  faction(id) {
    return this.factions.find((f) => f.id === id) ?? null;
  }

  army(id) {
    return this.armies.find((a) => a.id === id) ?? null;
  }

  armiesOf(factionId) {
    return this.armies.filter((a) => a.faction === factionId);
  }

  regionsOf(factionId) {
    return this.regions.filter((r) => r.owner === factionId);
  }

  incomeOf(factionId) {
    return this.regionsOf(factionId).reduce((sum, r) => sum + r.income, 0);
  }

  /** Idle armies standing in a region, in id order. */
  armiesIn(regionId) {
    return this.armies.filter((a) => a.status === ArmyStatus.IDLE && a.region === regionId);
  }

  /** Armies marching toward a region. */
  armiesBound(regionId) {
    return this.armies.filter((a) => a.status === ArmyStatus.MARCHING && a.destination === regionId);
  }

  log(text) {
    this.events.push({ time: this.time, text });
    if (this.events.length > 200) {
      this.events.shift();
    }
  }

  spawnArmy(factionId, regionId, strength) {
    const region = this.regions[regionId];
    const army = {
      id: this.nextArmyId,
      faction: factionId,
      strength,
      status: ArmyStatus.IDLE,
      region: regionId,
      destination: null,
      route: [],
      routeIndex: 0,
      position: this.map.gridToWorldCenter(region.center.x, region.center.y),
    };
    this.nextArmyId += 1;
    this.armies.push(army);
    return army;
  }

  /**
   * Orders an idle army to hold or to march to an adjacent region.
   *
   * @returns {boolean} whether the order was legal and applied.
   */
  orderArmy(factionId, armyId, order) {
    const army = this.army(armyId);
    if (!army || army.faction !== factionId || army.status !== ArmyStatus.IDLE) {
      return false;
    }

    if (order.type === "hold") {
      return true;
    }

    if (order.type !== "move" || !this.regions[army.region].neighbors.includes(order.to)) {
      return false;
    }

    army.status = ArmyStatus.MARCHING;
    army.destination = order.to;
    army.route = this.routes.get(`${army.region}>${order.to}`) ?? [];
    army.routeIndex = 0;
    return true;
  }

  /**
   * Where a faction's new armies muster: its capital while it holds it, else its best-defended region —
   * never a region with an enemy army in it, or a besieged faction could reset a capture forever by
   * raising armies inside it.
   */
  musterRegion(factionId) {
    const safe = (region) =>
      region.owner === factionId && this.armiesIn(region.id).every((a) => a.faction === factionId);
    const capital = this.regions[this.faction(factionId).capital];
    if (safe(capital)) {
      return capital.id;
    }
    const owned = this.regions.filter(safe).sort((a, b) => b.garrison - a.garrison || a.id - b.id);
    return owned.length > 0 ? owned[0].id : null;
  }

  /** Total army strength a faction's territory can support. */
  supplyOf(factionId) {
    return this.incomeOf(factionId) * this.params.supplyPerIncome;
  }

  armyStrengthOf(factionId) {
    return this.armiesOf(factionId).reduce((sum, a) => sum + a.strength, 0);
  }

  canRecruit(factionId) {
    const faction = this.faction(factionId);
    return (
      Boolean(faction) &&
      !faction.eliminated &&
      faction.gold >= this.params.recruitCost &&
      this.armyStrengthOf(factionId) + this.params.recruitStrength <= this.supplyOf(factionId) &&
      this.armiesOf(factionId).length < this.params.maxArmies &&
      this.musterRegion(factionId) !== null
    );
  }

  /** Spends gold on a new army at the muster region. */
  recruit(factionId) {
    if (!this.canRecruit(factionId)) {
      return null;
    }
    const faction = this.faction(factionId);
    faction.gold -= this.params.recruitCost;
    const regionId = this.musterRegion(factionId);
    const army = this.spawnArmy(factionId, regionId, this.params.recruitStrength);
    this.log(`${faction.name} raises an army at ${this.regions[regionId].name}.`);
    return army;
  }

  tick(dt) {
    if (this.winner) {
      return;
    }

    this.time += dt;
    this.collectIncome(dt);
    this.march(dt);
    this.mergeArmies();
    for (const region of this.regions) {
      this.resolveRegion(region, dt);
    }
    this.armies = this.armies.filter((a) => a.strength >= this.params.minArmyStrength);
    this.checkFactions();
  }

  collectIncome(dt) {
    for (const faction of this.factions) {
      if (!faction.eliminated) {
        faction.gold += this.incomeOf(faction.id) * this.params.goldPerIncome * dt;
      }
    }
  }

  march(dt) {
    for (const army of this.armies) {
      if (army.status !== ArmyStatus.MARCHING) {
        continue;
      }

      let budget = this.params.armySpeed * dt;
      while (budget > 0 && army.routeIndex < army.route.length) {
        const target = army.route[army.routeIndex];
        const dx = target.x - army.position.x;
        const dy = target.y - army.position.y;
        const gap = Math.hypot(dx, dy);
        if (gap <= budget) {
          army.position = { x: target.x, y: target.y };
          army.routeIndex += 1;
          budget -= gap;
        } else {
          army.position = { x: army.position.x + (dx / gap) * budget, y: army.position.y + (dy / gap) * budget };
          budget = 0;
        }
      }

      if (army.routeIndex >= army.route.length) {
        army.status = ArmyStatus.IDLE;
        army.region = army.destination;
        army.destination = null;
        army.route = [];
        army.routeIndex = 0;
      }
    }
  }

  /** Two idle armies of one faction in one region become one. */
  mergeArmies() {
    const absorbed = new Set();
    for (const army of this.armies) {
      if (absorbed.has(army.id) || army.status !== ArmyStatus.IDLE) {
        continue;
      }
      for (const other of this.armies) {
        if (
          other !== army &&
          !absorbed.has(other.id) &&
          other.status === ArmyStatus.IDLE &&
          other.faction === army.faction &&
          other.region === army.region
        ) {
          army.strength += other.strength;
          absorbed.add(other.id);
        }
      }
    }
    if (absorbed.size > 0) {
      this.armies = this.armies.filter((a) => !absorbed.has(a.id));
    }
  }

  /** Fighting, then capture, then garrison regrowth, for one region. */
  resolveRegion(region, dt) {
    const p = this.params;
    const ownerKey = region.owner ?? NEUTRAL;
    const sides = new Map();
    const addTo = (key, strength) => sides.set(key, (sides.get(key) ?? 0) + strength);

    const present = this.armiesIn(region.id);
    for (const army of present) {
      addTo(army.faction, army.strength);
    }
    if (region.garrison > 0) {
      addTo(ownerKey, region.garrison);
    }

    region.contested = sides.size >= 2;

    if (region.contested) {
      const total = [...sides.values()].reduce((a, b) => a + b, 0);
      const damage = new Map([...sides.keys()].map((k) => [k, 0]));

      // Each side splits its fire across the others by their share of the strength present.
      for (const [shooter, strength] of sides) {
        const fire = strength * p.lethality * dt * (shooter === ownerKey ? p.defenderBonus : 1);
        const targets = total - strength;
        for (const [target, targetStrength] of sides) {
          if (target !== shooter) {
            damage.set(target, damage.get(target) + fire * (targetStrength / targets));
          }
        }
      }

      // A side's losses fall on its armies and garrison in proportion to their strength.
      for (const [key, strength] of sides) {
        const ratio = Math.max(0, 1 - damage.get(key) / strength);
        for (const army of present) {
          if (army.faction === key) {
            army.strength *= ratio;
          }
        }
        if (key === ownerKey) {
          region.garrison *= ratio;
          if (region.garrison < 0.05) {
            region.garrison = 0;
          }
        }
      }

      region.captureProgress = 0;
      return;
    }

    const occupier = present.length > 0 ? present[0].faction : null;
    if (occupier && occupier !== region.owner) {
      region.captureProgress += dt;
      if (region.captureProgress >= p.captureSeconds) {
        const previous = region.owner ? this.faction(region.owner).name : "neutral";
        region.owner = occupier;
        region.garrison = 0;
        region.captureProgress = 0;
        this.log(`${this.faction(occupier).name} takes ${region.name} from ${previous}.`);
      }
      return;
    }

    region.captureProgress = 0;
    if (region.owner) {
      region.garrison = Math.min(this.garrisonCap(region), region.garrison + p.garrisonRegen * dt);
    }
  }

  checkFactions() {
    for (const faction of this.factions) {
      if (!faction.eliminated && this.regionsOf(faction.id).length === 0 && this.armiesOf(faction.id).length === 0) {
        faction.eliminated = true;
        this.log(`${faction.name} is wiped from the map.`);
      }
    }

    const alive = this.factions.filter((f) => !f.eliminated);
    const dominant = alive.find(
      (f) => this.regionsOf(f.id).length >= Math.ceil(this.regions.length * this.params.dominationShare),
    );

    if (alive.length === 1 || dominant) {
      this.winner = (dominant ?? alive[0]).id;
      this.log(`${this.faction(this.winner).name} has taken over the map.`);
    } else if (alive.length === 0) {
      this.winner = NEUTRAL;
    }
  }

  /** How strong a faction is in total: armies plus garrisons. */
  strengthOf(factionId) {
    const armies = this.armyStrengthOf(factionId);
    const garrisons = this.regionsOf(factionId).reduce((sum, r) => sum + r.garrison, 0);
    return armies + garrisons;
  }
}
