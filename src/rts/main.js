/**
 * Browser front end for the RTS prototype.
 *
 * A spectator view: four factions play each other and you choose who commands
 * each one — the local heuristic, or a decision model (Jev through OpenRouter).
 * The side panel shows each round of decisions as they come back: what every
 * army was asked, what was chosen, how sure the model was, and whether the
 * answer came from the model or had to be filled in.
 *
 * Unlike the headless runner, the world does not wait for a model here. A
 * commander's round runs while the game keeps moving, and orders that no longer
 * fit by the time they arrive are dropped — which is what makes latency part of
 * the comparison.
 */

import { DEFAULT_DECISION_MODEL, createDecisionModelProvider } from "./decisions/decisionsApi.js";
import { createHeuristicProvider } from "./decisions/heuristic.js";
import { createMatch } from "./match.js";
import { Terrain } from "./mapGen.js";
import { ArmyStatus } from "./world.js";

const TICK_SECONDS = 1 / 20;
const MAX_FRAME_SECONDS = 0.25;
const DECISION_HISTORY = 12;

const COLORS = {
  plains: "#1f2937",
  plainsAlt: "#232f3f",
  mountain: "#4b5563",
  water: "#1e3a5f",
  border: "rgba(15, 23, 42, 0.85)",
  label: "rgba(226, 232, 240, 0.85)",
  contested: "#f87171",
  route: "rgba(226, 232, 240, 0.45)",
};

const canvas = document.getElementById("rtsCanvas");
const ctx = canvas.getContext("2d");
const ui = {
  seed: document.getElementById("seed"),
  regenerate: document.getElementById("regenerate"),
  pause: document.getElementById("pause"),
  speed: document.getElementById("speed"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  factions: document.getElementById("factions"),
  decisions: document.getElementById("decisions"),
  events: document.getElementById("events"),
  status: document.getElementById("status"),
};

ui.model.value = DEFAULT_DECISION_MODEL;

/** Which commander each faction has, kept across new matches. */
const commanderChoice = { crimson: "heuristic", azure: "heuristic", verdant: "heuristic", amber: "heuristic" };

let match = null;
let paused = false;
let accumulator = 0;
let lastTimestamp = null;
let terrainLayer = null;
let ownerLayer = null;
let ownerSignature = "";
let decisionLog = [];
let renderedEvents = -1;

function tileSize() {
  return canvas.width / match.world.map.width;
}

function makeProvider(choice) {
  if (choice === "model") {
    return createDecisionModelProvider({ apiKey: ui.apiKey.value.trim(), model: ui.model.value.trim() || DEFAULT_DECISION_MODEL });
  }
  return createHeuristicProvider();
}

function applyProviders() {
  for (const commander of match.commanders) {
    commander.provider = makeProvider(commanderChoice[commander.factionId]);
  }
}

function newMatch() {
  const seed = Number.parseInt(ui.seed.value, 10) || 0;
  match = createMatch({ seed });
  applyProviders();
  decisionLog = [];
  renderedEvents = -1;
  accumulator = 0;
  terrainLayer = buildTerrainLayer();
  ownerLayer = null;
  ownerSignature = "";
  renderFactionTable();
  renderDecisions();
}

// ---------------------------------------------------------------- layers

function offscreen() {
  const layer = document.createElement("canvas");
  layer.width = canvas.width;
  layer.height = canvas.height;
  return layer;
}

/** Terrain and region borders never change during a match, so they are drawn once. */
function buildTerrainLayer() {
  const { world } = match;
  const layer = offscreen();
  const g = layer.getContext("2d");
  const size = tileSize();
  const { width, height } = world.map;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const terrain = world.terrain[x + y * width];
      g.fillStyle =
        terrain === Terrain.MOUNTAIN ? COLORS.mountain : terrain === Terrain.WATER ? COLORS.water : (x + y) % 2 ? COLORS.plains : COLORS.plainsAlt;
      g.fillRect(x * size, y * size, size + 0.5, size + 0.5);
    }
  }

  g.strokeStyle = COLORS.border;
  g.lineWidth = 2;
  g.beginPath();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = world.regionOf[x + y * width];
      if (id < 0) {
        continue;
      }
      if (x + 1 < width && world.regionOf[x + 1 + y * width] >= 0 && world.regionOf[x + 1 + y * width] !== id) {
        g.moveTo((x + 1) * size, y * size);
        g.lineTo((x + 1) * size, (y + 1) * size);
      }
      if (y + 1 < height && world.regionOf[x + (y + 1) * width] >= 0 && world.regionOf[x + (y + 1) * width] !== id) {
        g.moveTo(x * size, (y + 1) * size);
        g.lineTo((x + 1) * size, (y + 1) * size);
      }
    }
  }
  g.stroke();

  return layer;
}

/** Ownership tint, redrawn only when a region changes hands. */
function refreshOwnerLayer() {
  const { world } = match;
  const signature = world.regions.map((r) => r.owner ?? "-").join(",");
  if (ownerLayer && signature === ownerSignature) {
    return;
  }
  ownerSignature = signature;
  ownerLayer = ownerLayer ?? offscreen();
  const g = ownerLayer.getContext("2d");
  g.clearRect(0, 0, ownerLayer.width, ownerLayer.height);
  const size = tileSize();
  const { width, height } = world.map;
  g.globalAlpha = 0.38;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = world.regionOf[x + y * width];
      const owner = id >= 0 ? world.regions[id].owner : null;
      if (owner) {
        g.fillStyle = world.faction(owner).color;
        g.fillRect(x * size, y * size, size + 0.5, size + 0.5);
      }
    }
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- drawing

function toCanvas(point) {
  const size = tileSize();
  return { x: point.x * size, y: point.y * size };
}

function drawRegions() {
  const { world } = match;
  const size = tileSize();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const region of world.regions) {
    const c = toCanvas({ x: region.center.x + 0.5, y: region.center.y + 0.5 });
    const labelY = c.y - size * 2.3;

    ctx.font = `${Math.round(size * 0.95)}px Arial, sans-serif`;
    ctx.fillStyle = COLORS.label;
    ctx.fillText(`${region.capitalOf ? "★ " : ""}${region.name}`, c.x, labelY);

    // Garrison as pips, income as the count of slots.
    const cap = world.garrisonCap(region);
    const pipWidth = size * 0.7;
    const startX = c.x - (cap * pipWidth) / 2;
    for (let i = 0; i < cap; i += 1) {
      const fill = Math.max(0, Math.min(1, region.garrison - i));
      ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
      ctx.fillRect(startX + i * pipWidth, labelY + size * 0.75, pipWidth - 2, size * 0.35);
      ctx.fillStyle = region.owner ? world.faction(region.owner).color : "#94a3b8";
      ctx.fillRect(startX + i * pipWidth, labelY + size * 0.75, (pipWidth - 2) * fill, size * 0.35);
    }

    if (region.contested) {
      ctx.strokeStyle = COLORS.contested;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, size * 2.4 + Math.sin(world.time * 8) * 2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (region.captureProgress > 0) {
      const occupier = world.armiesIn(region.id)[0];
      ctx.strokeStyle = occupier ? world.faction(occupier.faction).color : COLORS.label;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(c.x, c.y, size * 2.4, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * region.captureProgress) / world.params.captureSeconds);
      ctx.stroke();
    }
  }
}

function drawArmies() {
  const { world } = match;
  const size = tileSize();
  const perRegion = new Map();

  for (const army of world.armies) {
    let pos = army.position;
    if (army.status === ArmyStatus.IDLE) {
      // Armies of different factions standing in one region are fanned out so both stay visible.
      const slot = perRegion.get(army.region) ?? 0;
      perRegion.set(army.region, slot + 1);
      const center = world.map.gridToWorldCenter(world.regions[army.region].center.x, world.regions[army.region].center.y);
      const angle = slot * 2.1;
      pos = slot === 0 ? center : { x: center.x + Math.cos(angle) * 1.4, y: center.y + Math.sin(angle) * 1.4 };
    } else {
      const dest = world.regions[army.destination].center;
      const from = toCanvas(army.position);
      const to = toCanvas({ x: dest.x + 0.5, y: dest.y + 0.5 });
      ctx.strokeStyle = COLORS.route;
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const c = toCanvas(pos);
    const radius = size * (0.55 + Math.sqrt(army.strength) * 0.16);
    ctx.fillStyle = world.faction(army.faction).color;
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.font = `bold ${Math.round(Math.max(size * 0.85, radius * 0.9))}px Arial, sans-serif`;
    ctx.fillText(String(Math.round(army.strength)), c.x, c.y + 1);
  }
}

function drawWinner() {
  const { world } = match;
  if (!world.winner) {
    return;
  }
  const faction = world.faction(world.winner);
  ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
  ctx.fillRect(0, canvas.height / 2 - 60, canvas.width, 120);
  ctx.fillStyle = faction?.color ?? "#e5e7eb";
  ctx.font = "bold 48px Arial, sans-serif";
  ctx.fillText(faction ? `${faction.name} takes the map` : "Nobody is left", canvas.width / 2, canvas.height / 2);
}

function draw() {
  refreshOwnerLayer();
  ctx.drawImage(terrainLayer, 0, 0);
  ctx.drawImage(ownerLayer, 0, 0);
  drawRegions();
  drawArmies();
  drawWinner();
}

// ---------------------------------------------------------------- side panel

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function renderFactionTable() {
  const { world } = match;
  ui.factions.innerHTML = world.factions
    .map(
      (f) => `<tr>
        <td><span class="swatch" style="background:${f.color}"></span>${f.name}</td>
        <td data-cell="regions-${f.id}"></td>
        <td data-cell="army-${f.id}"></td>
        <td data-cell="gold-${f.id}"></td>
        <td class="commander">
          <select data-faction="${f.id}" aria-label="${f.name} commander">
            <option value="heuristic"${commanderChoice[f.id] === "heuristic" ? " selected" : ""}>Heuristic</option>
            <option value="model"${commanderChoice[f.id] === "model" ? " selected" : ""}>Jev</option>
          </select>
          <div class="muted" data-cell="stats-${f.id}"></div>
        </td>
      </tr>`,
    )
    .join("");

  for (const select of ui.factions.querySelectorAll("select[data-faction]")) {
    select.addEventListener("change", () => {
      commanderChoice[select.dataset.faction] = select.value;
      applyProviders();
    });
  }
}

function updateFactionTable() {
  const { world, commanders } = match;
  const set = (key, text) => {
    const cell = ui.factions.querySelector(`[data-cell="${key}"]`);
    if (cell && cell.textContent !== text) {
      cell.textContent = text;
    }
  };

  for (const f of world.factions) {
    const commander = commanders.find((c) => c.factionId === f.id);
    set(`regions-${f.id}`, f.eliminated ? "—" : String(world.regionsOf(f.id).length));
    set(`army-${f.id}`, f.eliminated ? "—" : `${Math.round(world.armyStrengthOf(f.id))}/${Math.round(world.supplyOf(f.id))}`);
    set(`gold-${f.id}`, f.eliminated ? "—" : String(Math.floor(f.gold)));
    const last = commander.lastRound;
    const parts = [];
    if (commander.pending) {
      parts.push("thinking…");
    } else if (last) {
      parts.push(`${last.latencyMs} ms`);
    }
    if (commander.failures > 0) {
      parts.push(`${commander.failures} failed`);
    }
    if (commander.totalCost > 0) {
      parts.push(`$${commander.totalCost.toFixed(4)}`);
    }
    set(`stats-${f.id}`, parts.join(" · "));
  }
}

function describeChoice(round, id) {
  const answer = round.answers[id];
  const source = round.sources[id];
  if (answer.type === "noul") {
    return `<div>recruit? <strong>${answer.noul >= 0.5 ? "yes" : "no"}</strong> <span class="muted">p=${answer.noul.toFixed(2)}</span> <span class="src-${source}">${source}</span></div>`;
  }
  const criteria = round.questions[id].criteria;
  const probabilities = Object.entries(answer.probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, p]) => `${escapeHtml(key)} ${(p * 100).toFixed(0)}%`)
    .join(", ");
  const order = round.orders.find((o) => o.question === id);
  const dropped = order && !order.applied ? ' <span class="bad">(stale, dropped)</span>' : "";
  return `<div>${escapeHtml(id.replace("army_", "army "))}: <strong>${escapeHtml(criteria[answer.choice] ?? answer.choice)}</strong>${dropped}
    <span class="muted">${probabilities}</span> <span class="src-${source}">${source}</span></div>`;
}

function renderDecisions() {
  ui.decisions.innerHTML =
    decisionLog
      .map(({ faction, round }) => {
        const header = `<div><span class="swatch" style="background:${faction.color}"></span><strong>${faction.name}</strong>
          <span class="muted">t=${Math.round(round.time)}s · ${escapeHtml(round.model)} · ${round.latencyMs} ms</span></div>`;
        const error = round.error ? `<div class="bad">${escapeHtml(round.error)}</div>` : "";
        return `<div class="round">${header}${error}${Object.keys(round.answers).map((id) => describeChoice(round, id)).join("")}</div>`;
      })
      .join("") || '<div class="muted">No decisions yet.</div>';
}

function updateEvents() {
  const { events } = match.world;
  const marker = events.length > 0 ? events[events.length - 1].time + events.length : 0;
  if (marker === renderedEvents) {
    return;
  }
  renderedEvents = marker;
  ui.events.innerHTML = events
    .slice(-40)
    .reverse()
    .map((e) => `<div><span class="muted">${Math.round(e.time)}s</span> ${escapeHtml(e.text)}</div>`)
    .join("");
}

function updateStatus() {
  const { world } = match;
  const thinking = match.commanders.filter((c) => c.pending).length;
  ui.status.textContent =
    `Seed ${world.seed} · ${Math.floor(world.time)} s · ${world.regions.filter((r) => !r.owner).length} neutral regions` +
    (thinking > 0 ? ` · ${thinking} commander${thinking > 1 ? "s" : ""} thinking` : "") +
    (paused ? " · paused" : "");
}

// ---------------------------------------------------------------- loop

function step(dt) {
  const current = match;
  for (const commander of current.commanders) {
    const round = commander.update(dt);
    round?.then((result) => {
      if (result && match === current) {
        decisionLog.unshift({ faction: current.world.faction(commander.factionId), round: result });
        decisionLog.length = Math.min(decisionLog.length, DECISION_HISTORY);
        renderDecisions();
      }
    });
  }
  current.world.tick(dt);
}

function frame(timestamp) {
  const elapsed = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, MAX_FRAME_SECONDS);
  lastTimestamp = timestamp;

  if (!paused && !match.world.winner) {
    accumulator += elapsed * Number(ui.speed.value);
    while (accumulator >= TICK_SECONDS) {
      step(TICK_SECONDS);
      accumulator -= TICK_SECONDS;
    }
  }

  draw();
  updateFactionTable();
  updateEvents();
  updateStatus();
  window.requestAnimationFrame(frame);
}

ui.regenerate.addEventListener("click", newMatch);
ui.seed.addEventListener("change", newMatch);
ui.pause.addEventListener("click", () => {
  paused = !paused;
  ui.pause.textContent = paused ? "Resume" : "Pause";
});
ui.apiKey.addEventListener("change", applyProviders);
ui.model.addEventListener("change", applyProviders);

newMatch();
window.requestAnimationFrame(frame);
