#!/usr/bin/env node
/**
 * Plays RTS matches without a screen and reports who won.
 *
 * Usage:
 *   npm run rts-match                                   # 10 heuristic-only matches, seeds 0..9
 *   npm run rts-match -- --matches 50 --first-seed 100
 *   OPENROUTER_API_KEY=sk-or-… npm run rts-match -- --model-factions azure --matches 5
 *   npm run rts-match -- --model-factions crimson,azure --model typesafe/jev-1.13 \
 *       --endpoint https://example.test/api/alpha/decisions --log rounds.jsonl
 *
 * Factions named in `--model-factions` are commanded by the decision model at
 * `--endpoint` (OpenRouter's Decisions API by default); the rest use the local
 * heuristic. Matches run in lockstep, so a model's latency does not change the
 * outcome — only its answers do. `--log` writes every decision round as one
 * JSON line, request questions and answers included.
 */

import { appendFile, writeFile } from "node:fs/promises";

import { FACTIONS } from "../src/rts/config.js";
import {
  DEFAULT_DECISION_MODEL,
  OPENROUTER_DECISIONS_ENDPOINT,
  createDecisionModelProvider,
} from "../src/rts/decisions/decisionsApi.js";
import { runMatch } from "../src/rts/match.js";

function parseArgs(argv) {
  const options = {
    matches: 10,
    firstSeed: 0,
    maxSeconds: 900,
    modelFactions: [],
    model: DEFAULT_DECISION_MODEL,
    endpoint: OPENROUTER_DECISIONS_ENDPOINT,
    log: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case "--matches":
        options.matches = Math.max(1, Number.parseInt(value, 10) || 1);
        i += 1;
        break;
      case "--first-seed":
        options.firstSeed = Number.parseInt(value, 10) || 0;
        i += 1;
        break;
      case "--max-seconds":
        options.maxSeconds = Math.max(1, Number(value) || options.maxSeconds);
        i += 1;
        break;
      case "--model-factions":
        options.modelFactions = String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        i += 1;
        break;
      case "--model":
        options.model = value;
        i += 1;
        break;
      case "--endpoint":
        options.endpoint = value;
        i += 1;
        break;
      case "--log":
        options.log = value;
        i += 1;
        break;
      default:
        break;
    }
  }

  const known = new Set(FACTIONS.map((f) => f.id));
  for (const id of options.modelFactions) {
    if (!known.has(id)) {
      throw new Error(`Unknown faction "${id}". Factions: ${[...known].join(", ")}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";

  if (options.modelFactions.length > 0 && !apiKey) {
    console.error("Set OPENROUTER_API_KEY to let a decision model command a faction.");
    process.exitCode = 1;
    return;
  }
  if (options.log) {
    await writeFile(options.log, "");
  }

  const wins = Object.fromEntries(FACTIONS.map((f) => [f.id, 0]));
  let undecided = 0;
  let totalCost = 0;

  for (let n = 0; n < options.matches; n += 1) {
    const seed = options.firstSeed + n;
    const providers = Object.fromEntries(
      options.modelFactions.map((id) => [
        id,
        createDecisionModelProvider({ apiKey, model: options.model, endpoint: options.endpoint }),
      ]),
    );

    const onRound = options.log
      ? (commander, round) =>
          appendFile(options.log, `${JSON.stringify({ seed, faction: commander.factionId, ...round })}\n`)
      : undefined;

    const { world, commanders, winner, seconds } = await runMatch({
      seed,
      providers,
      maxSeconds: options.maxSeconds,
      onRound,
    });

    if (winner) {
      wins[winner] += 1;
    } else {
      undecided += 1;
    }

    const summary = world.factions
      .map((f) => {
        const commander = commanders.find((c) => c.factionId === f.id);
        totalCost += commander.totalCost;
        const tag = options.modelFactions.includes(f.id) ? "*" : "";
        const failed = commander.failures > 0 ? ` ${commander.failures} failed` : "";
        return `${f.name}${tag} ${world.regionsOf(f.id).length}r${failed}`;
      })
      .join("  ");
    console.log(`seed ${seed}: ${winner ? world.faction(winner).name : "no winner"} at ${Math.round(seconds)} s  |  ${summary}`);
  }

  console.log("");
  console.log(`Wins: ${Object.entries(wins).map(([id, w]) => `${id} ${w}`).join(", ")}${undecided ? `, undecided ${undecided}` : ""}`);
  if (options.modelFactions.length > 0) {
    console.log(`Model-commanded (*): ${options.modelFactions.join(", ")} via ${options.model}; spent $${totalCost.toFixed(4)}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
