import { StrategicCommander } from "./decisions/commander.js";
import { createHeuristicProvider } from "./decisions/heuristic.js";
import { RtsWorld } from "./world.js";

/**
 * A world plus one commander per faction.
 *
 * Commanders are staggered across the decision interval so the factions do not
 * all think on the same tick.
 */
export function createMatch({ seed = 0, providers = {}, params = {} } = {}) {
  const world = new RtsWorld({ seed, params });
  const interval = world.params.decisionInterval;
  const commanders = world.factions.map(
    (faction, index) =>
      new StrategicCommander({
        world,
        factionId: faction.id,
        provider: providers[faction.id] ?? createHeuristicProvider(),
        offset: (interval * index) / world.factions.length,
      }),
  );
  return { world, commanders };
}

/**
 * Plays a match to the end without a screen.
 *
 * Runs in lockstep: when a commander starts a decision round, the world waits
 * for its answers before ticking on. With the heuristic on every side that
 * makes a match a pure function of its seed; with a remote model it makes the
 * result independent of network latency.
 *
 * @returns {Promise<{world: RtsWorld, commanders: StrategicCommander[], seconds: number, winner: string|null}>}
 */
export async function runMatch({ seed = 0, providers = {}, params = {}, dt = 1 / 10, maxSeconds = 900, onRound } = {}) {
  const { world, commanders } = createMatch({ seed, providers, params });

  while (!world.winner && world.time < maxSeconds) {
    for (const commander of commanders) {
      const round = commander.update(dt);
      if (round) {
        const result = await round;
        if (result && onRound) {
          onRound(commander, result);
        }
      }
    }
    world.tick(dt);
  }

  return { world, commanders, seconds: world.time, winner: world.winner };
}
