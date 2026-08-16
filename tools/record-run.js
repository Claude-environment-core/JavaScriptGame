#!/usr/bin/env node
/**
 * Records runs of the test fixtures.
 *
 * Usage:
 *   npm run record                  # writes recordings/ next to the repo root
 *   npm run record -- --out ./tmp   # writes somewhere else
 *   npm run record -- --every 5     # records every 5th tick
 *
 * Each recording holds the map tiles, the route, per-tick agent positions and
 * velocities, the formation's deformation state, and the run's metrics. Diff two
 * recordings to find the first tick where a change altered behaviour.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAgents } from "../src/sim/agent.js";
import { runAndRecord } from "../src/sim/snapshot.js";
import { createSquadController } from "../src/sim/squad.js";
import {
  buildFixtureA,
  buildFixtureB,
  buildFixtureC,
  buildFixtureD,
  buildFixtureE,
} from "../tests/fixtures.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { out: resolve(repoRoot, "recordings"), every: 1 };

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

async function record(fixture, label, options) {
  const controller = createSquadController({
    agents: createAgents(fixture.startPositions),
    map: fixture.map,
    goal: fixture.goal,
  });

  if (!controller) {
    throw new Error(`${label}: no route from start to goal`);
  }

  const { snapshot, metrics, ticks, arrived } = runAndRecord(controller, {
    dt: fixture.dt,
    maxTicks: fixture.maxTicks,
    arrivalRadius: fixture.arrivalRadius,
    everyNthTick: options.every,
    label,
  });

  const target = resolve(options.out, `${label}.json`);
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(
    [
      `${label.padEnd(12)}`,
      `${String(ticks).padStart(4)} ticks`,
      `arrived=${arrived}`,
      `slotError=${metrics.meanSlotError}`,
      `closest=${metrics.minimumAgentGap}`,
      `wallEntries=${metrics.blockedTileEntries}`,
      `reassignments=${metrics.reassignments}`,
    ].join("  "),
  );
}

const options = parseArgs(process.argv.slice(2));
await mkdir(options.out, { recursive: true });
await record(buildFixtureA(), "fixture-a", options);
await record(buildFixtureB(), "fixture-b", options);
await record(buildFixtureC({ corridorWidth: 1 }), "fixture-c-narrow", options);
await record(buildFixtureC({ corridorWidth: 3 }), "fixture-c-wide", options);
await record(buildFixtureD(), "fixture-d", options);
await record(buildFixtureE(), "fixture-e", options);
