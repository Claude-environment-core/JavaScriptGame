import { clone, vec2 } from "./vec2.js";

/**
 * Role and state are behavioural placeholders in the source simulation: combat,
 * recon and support logic is stubbed, and movement is entirely flock driven.
 * They are carried through so ports stay data compatible.
 */
export const AgentRole = Object.freeze({
  Rifleman: "Rifleman",
  Scout: "Scout",
  Support: "Support",
  Medic: "Medic",
});

export const AgentState = Object.freeze({
  Idle: "Idle",
  Moving: "Moving",
  Engaging: "Engaging",
  Down: "Down",
});

export const DEFAULT_AGENT_HEALTH = 100;

/**
 * Agents occupy space. Body radius is the constant the rest of the simulation is
 * derived from: personal space, wall clearance, corridor margins and the limit
 * on how tightly a formation may squeeze all follow from it.
 */
export const DEFAULT_BODY_RADIUS = 0.25;

/**
 * Per-role health from configuration. Config values override the constructor
 * default, matching the source behaviour where loaded config wins.
 */
export const DEFAULT_HEALTH_CONFIG = Object.freeze({
  Rifleman: 100,
  Scout: 80,
  Support: 90,
  Medic: 85,
});

export class Agent {
  constructor({
    id,
    position = vec2(),
    velocity = vec2(),
    health = DEFAULT_AGENT_HEALTH,
    role = AgentRole.Rifleman,
    state = AgentState.Idle,
    healthConfig = null,
    bodyRadius = DEFAULT_BODY_RADIUS,
  } = {}) {
    this.id = id;
    this.position = clone(position);
    this.velocity = clone(velocity);
    this.role = role;
    this.state = state;
    this.bodyRadius = bodyRadius;

    // Config-driven health overrides the constructor default.
    const configuredHealth = healthConfig ? healthConfig[role] : undefined;
    this.health = configuredHealth === undefined ? health : configuredHealth;
    this.maxHealth = this.health;
  }

  get isAlive() {
    return this.health > 0;
  }

  applyDamage(amount) {
    this.health = Math.max(0, this.health - amount);

    if (this.health === 0) {
      this.state = AgentState.Down;
    }

    return this.health;
  }
}

/**
 * Builds a squad of agents at the given world positions.
 */
export function createAgents(positions, options = {}) {
  return positions.map(
    (position, index) =>
      new Agent({
        id: options.idPrefix ? `${options.idPrefix}-${index}` : index,
        position,
        role: options.roles ? options.roles[index % options.roles.length] : AgentRole.Rifleman,
        state: AgentState.Moving,
        healthConfig: options.healthConfig ?? null,
        bodyRadius: options.bodyRadius ?? DEFAULT_BODY_RADIUS,
      }),
  );
}
