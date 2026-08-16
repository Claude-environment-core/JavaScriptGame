#!/usr/bin/env node
/**
 * Writes parity snapshots for the specification fixtures.
 *
 * Usage:
 *   npm run snapshot                  # writes snapshots/ next to the repo root
 *   npm run snapshot -- --out ./tmp   # writes somewhere else
 *   npm run snapshot -- --every 5     # records every 5th tick
 *
 * Each snapshot holds the map tiles, the A* path, the world-space waypoints and
 * per-tick agent positions and velocities. Diff two ports' snapshots to find the
 * first tick where they disagree.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAgents } from "../src/sim/agent.js";
import { runAndRecord } from "../src/sim/snapshot.js";
import { createSquadController } from "../src/sim/squad.js";
import { buildFixtureA, buildFixtureB } from "../tests/fixtures.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { out: resolve(repoRoot, "snapshots"), every: 1 };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) {
      options.out = resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--every" && argv[i + 1]) {
      options.every = Math.max(1, Number.parseInt(argv[i + 1], 10) || 1);
      i += 1;
    }
  }

  return options;
}

async function writeSnapshot(fixture, label, options) {
  const controller = createSquadController({
    agents: createAgents(fixture.startPositions),
    map: fixture.map,
    goal: fixture.goal,
  });

  if (!controller) {
    throw new Error(`${label}: no route from start to goal`);
  }

  const { snapshot, ticks, arrived } = runAndRecord(controller, {
    dt: fixture.dt,
    maxTicks: fixture.maxTicks,
    arrivalRadius: fixture.arrivalRadius,
    everyNthTick: options.every,
    label,
  });

  const target = resolve(options.out, `${label}.json`);
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(
    `${label}: ${ticks} ticks, arrived=${arrived}, ${snapshot.ticks.length} recorded -> ${target}`,
  );
}

const options = parseArgs(process.argv.slice(2));
await mkdir(options.out, { recursive: true });
await writeSnapshot(buildFixtureA(), "fixture-a", options);
await writeSnapshot(buildFixtureB(), "fixture-b", options);
