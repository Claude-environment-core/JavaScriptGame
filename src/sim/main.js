/**
 * Browser front end for the squad simulation.
 *
 * The page is a debug view, not a game: it generates a world, routes a squad
 * across it, and draws what the formation controller is working with — the
 * route, the spine the formation hangs off, the deformed slots, and each
 * agent's body and velocity.
 */

import { createAgents } from "./agent.js";
import { FormationType } from "./formation/shape.js";
import { findPath } from "./pathfinding.js";
import { KeyboardPlayerController, Player } from "./player.js";
import { DeterministicRandom } from "./rng.js";
import { createSquadController } from "./squad.js";
import { generateWorld } from "./worldGen.js";

const MAP_SIZE = 48;
const SQUAD_SIZE = 5;
const TICK_SECONDS = 1 / 60;

const COLORS = {
  floor: "#0f172a",
  wall: "#334155",
  grid: "rgba(148, 163, 184, 0.12)",
  path: "rgba(56, 189, 248, 0.45)",
  waypoint: "#38bdf8",
  goal: "#f472b6",
  anchor: "#facc15",
  spine: "rgba(250, 204, 21, 0.5)",
  slot: "rgba(250, 204, 21, 0.3)",
  agent: "#4ade80",
  agentRegrouping: "#fb923c",
  velocity: "#bbf7d0",
  playerVelocity: "#7dd3fc",
};

const MODE_LABEL = {
  Open: "open",
  Squeeze: "squeezing",
  File: "single file",
};

const canvas = document.getElementById("simCanvas");
const context = canvas.getContext("2d");

const ui = {
  formation: document.getElementById("formation"),
  speed: document.getElementById("speed"),
  seed: document.getElementById("seed"),
  regenerate: document.getElementById("regenerate"),
  reroute: document.getElementById("reroute"),
  pause: document.getElementById("pause"),
  status: document.getElementById("status"),
  legend: document.getElementById("legend"),
};

const state = {
  seed: 0,
  world: null,
  controller: null,
  player: null,
  random: new DeterministicRandom(0),
  paused: false,
  ticks: 0,
  reroutes: 0,
  lastFrame: 0,
  accumulator: 0,
};
const playerController = new KeyboardPlayerController();

for (const formation of Object.values(FormationType)) {
  const option = document.createElement("option");
  option.value = formation;
  option.textContent = formation;
  ui.formation.append(option);
}
ui.formation.value = FormationType.Wedge;

/** Every walkable cell, used to pick spawn points and objectives. */
function walkableCells(map) {
  const cells = [];

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (map.isWalkable(x, y)) {
        cells.push({ x, y });
      }
    }
  }

  return cells;
}

/** Picks a goal that is both reachable from `from` and a decent distance away. */
function pickGoal(map, from, cells) {
  let fallback = null;

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = cells[state.random.nextInt(0, cells.length)];
    if (!findPath(map, from, candidate)) {
      continue;
    }

    fallback = candidate;
    if (Math.hypot(candidate.x - from.x, candidate.y - from.y) > map.width / 3) {
      return candidate;
    }
  }

  return fallback;
}

/** Spawns the squad on the walkable cells nearest an origin, by flood fill. */
function spawnSquad(map, origin) {
  const positions = [];
  const seen = new Set([`${origin.x},${origin.y}`]);
  const queue = [origin];

  while (queue.length > 0 && positions.length < SQUAD_SIZE) {
    const cell = queue.shift();
    positions.push(map.gridToWorldCenter(cell.x, cell.y));

    for (const neighbor of map.neighbors(cell.x, cell.y)) {
      const key = `${neighbor.x},${neighbor.y}`;

      if (!seen.has(key) && map.isWalkable(neighbor.x, neighbor.y)) {
        seen.add(key);
        queue.push(neighbor);
      }
    }
  }

  return createAgents(positions, { idPrefix: "agent" });
}

function route(agents) {
  const { map } = state.world;
  const cells = walkableCells(map);
  const startCell = map.worldToGrid(agents[0].position);
  const goalCell = pickGoal(map, startCell, cells);

  if (!goalCell) {
    return null;
  }

  return createSquadController({
    agents,
    map,
    goal: map.gridToWorldCenter(goalCell.x, goalCell.y),
    formation: ui.formation.value,
  });
}

function rebuildWorld(seed) {
  state.seed = seed;
  state.random = new DeterministicRandom(seed + 1);
  state.world = generateWorld({ width: MAP_SIZE, height: MAP_SIZE, seed });

  const cells = walkableCells(state.world.map);
  const agents = spawnSquad(state.world.map, cells[state.random.nextInt(0, cells.length)]);
  const playerCell = cells[state.random.nextInt(0, cells.length)];
  state.player = new Player({
    position: state.world.map.gridToWorldCenter(playerCell.x, playerCell.y),
  });

  state.controller = route(agents);
  state.ticks = 0;
  state.reroutes = 0;
}

function reroute() {
  if (!state.controller) {
    rebuildWorld(state.seed);
    return;
  }

  const agents = state.controller.agents;
  const next = route(agents);

  if (next) {
    state.controller = next;
    state.reroutes += 1;
  }
}

function update(dt) {
  const controller = state.controller;
  if (!controller) {
    return;
  }

  controller.tick(dt);
  state.player?.tick(dt, state.world.map, playerController);
  state.ticks += 1;

  if (controller.hasArrived() || state.ticks > 60 * 90) {
    reroute();
    state.ticks = 0;
  }
}

function scale() {
  return canvas.width / MAP_SIZE;
}

function drawMap() {
  const { map } = state.world;
  const cell = scale();

  context.fillStyle = COLORS.floor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = COLORS.wall;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (!map.isWalkable(x, y)) {
        context.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  context.strokeStyle = COLORS.grid;
  context.lineWidth = 1;
  context.beginPath();
  for (let i = 0; i <= MAP_SIZE; i += 4) {
    context.moveTo(i * cell, 0);
    context.lineTo(i * cell, canvas.height);
    context.moveTo(0, i * cell);
    context.lineTo(canvas.width, i * cell);
  }
  context.stroke();
}

function drawRoute() {
  const controller = state.controller;
  const cell = scale();

  context.strokeStyle = COLORS.path;
  context.lineWidth = Math.max(2, cell * 0.25);
  context.beginPath();
  controller.plan.waypoints.forEach((point, index) => {
    const x = point.x * cell;
    const y = point.y * cell;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();

  const objective = controller.plan.objective;
  context.fillStyle = COLORS.goal;
  context.beginPath();
  context.arc(objective.x * cell, objective.y * cell, cell * 0.5, 0, Math.PI * 2);
  context.fill();

  const target = controller.plan.currentTarget;
  context.fillStyle = COLORS.waypoint;
  context.beginPath();
  context.arc(target.x * cell, target.y * cell, cell * 0.3, 0, Math.PI * 2);
  context.fill();
}

function drawSquad() {
  const controller = state.controller;
  const cell = scale();

  // The spine: the path the anchor travelled, which trailing slots hang off.
  const trail = controller.trail.points;
  if (trail.length > 1) {
    context.strokeStyle = COLORS.spine;
    context.lineWidth = Math.max(1, cell * 0.12);
    context.beginPath();
    trail.forEach((point, index) => {
      const method = index === 0 ? "moveTo" : "lineTo";
      context[method](point.x * cell, point.y * cell);
    });
    context.stroke();
  }

  context.fillStyle = COLORS.slot;
  for (const slot of controller.slots) {
    context.beginPath();
    context.arc(slot.x * cell, slot.y * cell, cell * 0.28, 0, Math.PI * 2);
    context.fill();
  }

  // Each agent to its slot, so the assignment is visible.
  context.strokeStyle = COLORS.slot;
  context.lineWidth = 1;
  context.beginPath();
  controller.agents.forEach((agent, index) => {
    const slot = controller.slotFor(index);
    context.moveTo(agent.position.x * cell, agent.position.y * cell);
    context.lineTo(slot.x * cell, slot.y * cell);
  });
  context.stroke();

  context.strokeStyle = COLORS.anchor;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(controller.anchor.x * cell, controller.anchor.y * cell, cell * 0.4, 0, Math.PI * 2);
  context.stroke();

  const regrouping = controller.isRegrouping;

  for (const agent of controller.agents) {
    const x = agent.position.x * cell;
    const y = agent.position.y * cell;

    context.strokeStyle = COLORS.velocity;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + agent.velocity.x * cell * 0.4, y + agent.velocity.y * cell * 0.4);
    context.stroke();

    // Bodies are drawn at their true radius: agents occupy space, and the
    // formation's limits are derived from that size.
    context.fillStyle = regrouping ? COLORS.agentRegrouping : COLORS.agent;
    context.beginPath();
    context.arc(x, y, agent.bodyRadius * cell, 0, Math.PI * 2);
    context.fill();
  }
}

function drawPlayer() {
  const player = state.player;
  if (!player) {
    return;
  }

  const cell = scale();
  const x = player.position.x * cell;
  const y = player.position.y * cell;

  context.strokeStyle = COLORS.playerVelocity;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + player.velocity.x * cell * 0.4, y + player.velocity.y * cell * 0.4);
  context.stroke();

  context.fillStyle = player.color;
  context.beginPath();
  context.arc(x, y, player.radius * cell, 0, Math.PI * 2);
  context.fill();
}

function render() {
  drawMap();

  if (!state.controller) {
    ui.status.textContent = "No route could be planned for this seed. Regenerate to try another.";
    return;
  }

  drawRoute();
  drawSquad();
  drawPlayer();

  const controller = state.controller;
  const deformation = controller.deformation;

  ui.status.textContent = [
    `seed ${state.seed}`,
    `${controller.agents.length} agents`,
    `${MODE_LABEL[deformation.mode]}, ${(deformation.halfWidth * 2).toFixed(1)} tiles wide`,
    `coherence ${(controller.coherence * 100).toFixed(0)}%`,
    `${controller.plan.waypoints.length} waypoints left`,
    `objectives reached ${state.reroutes}`,
    state.paused ? "paused" : "running",
  ].join(" · ");
}

function frame(timestamp) {
  const elapsed = state.lastFrame === 0 ? 0 : (timestamp - state.lastFrame) / 1000;
  state.lastFrame = timestamp;

  if (!state.paused) {
    // Fixed-step integration keeps the simulation independent of frame rate; the
    // speed control only changes how much simulated time a frame is worth.
    const speed = Number.parseFloat(ui.speed.value) || 1;
    state.accumulator = Math.min(state.accumulator + elapsed * speed, 0.25 * speed);

    while (state.accumulator >= TICK_SECONDS) {
      update(TICK_SECONDS);
      state.accumulator -= TICK_SECONDS;
    }
  }

  render();
  window.requestAnimationFrame(frame);
}

ui.regenerate.addEventListener("click", () => {
  const seed = Number.parseInt(ui.seed.value, 10);
  rebuildWorld(Number.isFinite(seed) ? seed : 0);
});

ui.reroute.addEventListener("click", () => reroute());

ui.pause.addEventListener("click", () => {
  state.paused = !state.paused;
  ui.pause.textContent = state.paused ? "Resume" : "Pause";
});

ui.formation.addEventListener("change", () => {
  if (state.controller) {
    state.controller.plan.formation = ui.formation.value;
  }
});

rebuildWorld(0);
window.requestAnimationFrame(frame);
