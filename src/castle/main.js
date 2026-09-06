/**
 * Browser front end for the castle level.
 *
 * Like the squad page, this is a debug view rather than a game: it generates a
 * castle and draws what the systems underneath are actually working with — the
 * wards, the chokepoints and which of them are live, every patrol beat, what
 * each guard can see, and the alarm working its way outward ward by ward.
 *
 * You drive one infiltrator with the keyboard; three allies follow in
 * formation under the same controller the garrison's relief columns use. The
 * point of playing with it is to watch the alert chain: get seen, and you can
 * see the shout, the ward alarm, the neighbours picking it up, the column
 * forming and marching, and the quiet doors closing ahead of you.
 */

import { AgentState, createAgents } from "../sim/agent.js";
import { FormationType } from "../sim/formation/shape.js";
import { KeyboardPlayerController, Player } from "../sim/player.js";
import { createSquadController } from "../sim/squad.js";
import { distance } from "../sim/vec2.js";
import { generateCastle } from "./generate.js";
import { AlertState, GuardStance, canSee } from "./garrison.js";
import { CastleTile } from "./layout.js";
import { CastleMission, MissionPhase } from "./mission.js";
import { WardType } from "./wards.js";

const MAP_SIZE = 144;
const ALLY_COUNT = 3;
const TICK_SECONDS = 1 / 60;
const FOLLOW_INTERVAL = 0.5;
const FOLLOW_DISTANCE = 5;
const INTERACT_RANGE = 2.5;

const COLORS = {
  ground: "#0b1120",
  floor: "#0f172a",
  curtain: "#5b6a80",
  innerCurtain: "#69788e",
  keepWall: "#7887a0",
  tower: "#8f9bb0",
  structure: "#4b4560",
  weakMasonry: "#8a6d4a",
  door: "#a3672f",
  grid: "rgba(148, 163, 184, 0.08)",
  patrol: "rgba(148, 163, 184, 0.28)",
  vision: "rgba(56, 189, 248, 0.05)",
  visionAlert: "rgba(248, 113, 113, 0.11)",
  guard: "#94a3b8",
  guardSuspicious: "#fbbf24",
  guardAlerted: "#f87171",
  guardRelief: "#c084fc",
  player: "#22d3ee",
  ally: "#4ade80",
  allyDown: "#475569",
  princess: "#f472b6",
  rally: "rgba(74, 222, 128, 0.5)",
  extraction: "rgba(74, 222, 128, 0.06)",
};

/**
 * Floor colour per ward. The four zones are the level's structure, so they are
 * painted as four grounds rather than tinted after the fact — each step inward
 * is a shade lighter and warmer, which reads as depth without a legend.
 */
const WARD_FLOOR = {
  [WardType.Approach]: "#111a29",
  [WardType.OuterBailey]: "#182032",
  [WardType.InnerBailey]: "#1f2539",
  [WardType.Keep]: "#2a2742",
};

const VECTOR_COLOR = {
  gate: "#38bdf8",
  postern: "#4ade80",
  kitchen: "#a3e635",
  sewer: "#2dd4bf",
  breach: "#fb923c",
  bribe: "#c084fc",
};

const TILE_COLOR = {
  [CastleTile.Bedrock]: "#0b1120",
  [CastleTile.Curtain]: COLORS.curtain,
  [CastleTile.InnerCurtain]: COLORS.innerCurtain,
  [CastleTile.KeepWall]: COLORS.keepWall,
  [CastleTile.Tower]: COLORS.tower,
  [CastleTile.Structure]: COLORS.structure,
  [CastleTile.WeakMasonry]: COLORS.weakMasonry,
  [CastleTile.Door]: COLORS.door,
};

/**
 * The infiltrator the keyboard drives.
 *
 * `Player` has movement and wall collision but no notion of being hurt, and
 * the mission needs a party of things that can be worn down and put back
 * together — so health is added here rather than in the mission, which will
 * take anything with a position and a way of taking damage.
 */
class Infiltrator extends Player {
  constructor(options) {
    super(options);
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.state = AgentState.Moving;
  }

  get isAlive() {
    return this.health > 0;
  }

  applyDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    return this.health;
  }
}

const canvas = document.getElementById("castleCanvas");
const context = canvas.getContext("2d");

const ui = {
  seed: document.getElementById("seed"),
  regenerate: document.getElementById("regenerate"),
  pause: document.getElementById("pause"),
  speed: document.getElementById("speed"),
  patrols: document.getElementById("showPatrols"),
  vision: document.getElementById("showVision"),
  status: document.getElementById("status"),
  vectors: document.getElementById("vectors"),
  log: document.getElementById("log"),
  notice: document.getElementById("notice"),
};

const input = new KeyboardPlayerController();

const state = {
  seed: 0,
  castle: null,
  garrison: null,
  mission: null,
  report: null,
  player: null,
  allies: [],
  squad: null,
  followTimer: 0,
  paused: false,
  notice: "",
  noticeTimer: 0,
  lastFrame: 0,
  accumulator: 0,
};

function rebuild(seed) {
  const generated = generateCastle({ width: MAP_SIZE, height: MAP_SIZE, seed });

  state.seed = seed;
  state.castle = generated.castle;
  state.garrison = generated.garrison;
  state.report = generated.report;

  const rally = generated.castle.map.gridToWorldCenter(
    generated.castle.landmarks.rally.x,
    generated.castle.landmarks.rally.y,
  );

  state.player = new Infiltrator({ position: rally, speed: 3.4 });
  state.allies = createAgents(
    Array.from({ length: ALLY_COUNT }, (_, i) => ({ x: rally.x + (i - 1) * 0.7, y: rally.y + 0.9 })),
    { idPrefix: "ally" },
  );

  state.mission = new CastleMission({
    castle: generated.castle,
    garrison: generated.garrison,
    party: [state.player, ...state.allies],
  });

  state.squad = null;
  state.followTimer = 0;
  renderVectorList();
}

/**
 * The allies follow by being re-routed to wherever the player has got to,
 * which is the existing squad controller doing exactly what it does for the
 * garrison's relief columns.
 */
function updateFollowers(dt) {
  state.followTimer -= dt;

  const alive = state.allies.filter((ally) => ally.isAlive);
  if (alive.length === 0) {
    state.squad = null;
    return;
  }

  const stale =
    !state.squad ||
    state.squad.agents.length !== alive.length ||
    distance(state.squad.plan.objective, state.player.position) > FOLLOW_DISTANCE;

  if (state.followTimer <= 0 && stale) {
    state.followTimer = FOLLOW_INTERVAL;

    const next = createSquadController({
      agents: alive,
      map: state.castle.map,
      goal: state.player.position,
      formation: alive.length >= 3 ? FormationType.Wedge : FormationType.Column,
    });

    if (next) {
      state.squad = next;
    }
  }

  state.squad?.tick(dt);
}

function update(dt) {
  state.player.tick(dt, state.castle.map, input);
  updateFollowers(dt);
  state.mission.tick(dt);

  if (state.noticeTimer > 0) {
    state.noticeTimer -= dt;
  }
}

/** Acts on whatever shut way in the player is standing next to. */
function interact() {
  const mission = state.mission;
  const candidates = state.castle.edges.filter(
    (edge) =>
      edge.isActive &&
      !edge.isOpen &&
      distance(state.player.position, mission.worldOf(edge.location)) <= INTERACT_RANGE,
  );

  if (candidates.length === 0) {
    say("Nothing here to open.");
    return;
  }

  const result = mission.interact(candidates[0].id, state.player);
  say(result.ok ? `Working on the ${candidates[0].vectorType}…` : `No: ${result.reason}.`);
}

function say(message) {
  state.notice = message;
  state.noticeTimer = 3;
}

function scale() {
  return canvas.width / MAP_SIZE;
}

function drawTiles() {
  const { map } = state.castle;
  const cell = scale();

  context.fillStyle = COLORS.ground;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const ward of state.castle.wardList) {
    context.fillStyle = WARD_FLOOR[ward.type] ?? COLORS.floor;

    for (const tile of state.castle.walkableTilesIn(ward.id)) {
      context.fillRect(tile.x * cell, tile.y * cell, cell + 0.5, cell + 0.5);
    }
  }

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const color = TILE_COLOR[map.get(x, y)];

      if (color) {
        context.fillStyle = color;
        context.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
      }
    }
  }
}

/**
 * The buffer: the band around the castle that the garrison neither walks nor
 * can see across. It is where the party forms up and what it has to get back
 * to, and nothing else occupies it.
 */
function drawBuffer() {
  const cell = scale();
  const apron = state.castle.landmarks.apron;

  context.fillStyle = COLORS.extraction;
  context.fillRect(0, 0, canvas.width, apron.minY * cell);
  context.fillRect(0, (apron.maxY + 1) * cell, canvas.width, canvas.height - (apron.maxY + 1) * cell);
  context.fillRect(0, apron.minY * cell, apron.minX * cell, (apron.maxY - apron.minY + 1) * cell);
  context.fillRect(
    (apron.maxX + 1) * cell,
    apron.minY * cell,
    canvas.width - (apron.maxX + 1) * cell,
    (apron.maxY - apron.minY + 1) * cell,
  );

  const rally = state.castle.landmarks.rally;
  context.strokeStyle = COLORS.rally;
  context.lineWidth = 2;
  context.beginPath();
  context.arc((rally.x + 0.5) * cell, (rally.y + 0.5) * cell, cell * 1.6, 0, Math.PI * 2);
  context.stroke();
}

function drawPatrols() {
  const cell = scale();
  context.strokeStyle = COLORS.patrol;
  context.lineWidth = 1;

  for (const ward of state.castle.wardList) {
    for (const route of ward.patrolRoutes) {
      if (route.waypoints.length < 2) {
        continue;
      }

      context.beginPath();
      route.waypoints.forEach((point, index) => {
        const method = index === 0 ? "moveTo" : "lineTo";
        context[method](point.x * cell, point.y * cell);
      });
      context.closePath();
      context.stroke();
    }
  }
}

function drawVision() {
  const cell = scale();

  for (const guard of state.garrison.guards) {
    const alerted = guard.alert !== AlertState.Unaware;
    const facing = Math.atan2(guard.facing.y, guard.facing.x);
    const half = state.garrison.params.fieldOfView / 2;

    context.fillStyle = alerted ? COLORS.visionAlert : COLORS.vision;
    context.beginPath();
    context.moveTo(guard.position.x * cell, guard.position.y * cell);
    context.arc(
      guard.position.x * cell,
      guard.position.y * cell,
      guard.visionRange * cell,
      facing - half,
      facing + half,
    );
    context.closePath();
    context.fill();
  }
}

function drawVectors() {
  const cell = scale();

  for (const edge of state.castle.edges) {
    if (!edge.isActive) {
      continue;
    }

    const color = VECTOR_COLOR[edge.vectorType] ?? "#94a3b8";
    const point = edge.mouth ?? edge.location;

    context.strokeStyle = color;
    context.globalAlpha = edge.isPassable ? 1 : 0.35;
    context.lineWidth = 2;
    context.beginPath();
    context.arc((point.x + 0.5) * cell, (point.y + 0.5) * cell, cell * 1.1, 0, Math.PI * 2);
    context.stroke();

    // A shut way in is crossed out rather than hidden: it is still a plan.
    if (!edge.isPassable) {
      context.beginPath();
      context.moveTo((point.x - 0.3) * cell, (point.y - 0.3) * cell);
      context.lineTo((point.x + 1.3) * cell, (point.y + 1.3) * cell);
      context.stroke();
    }

    context.globalAlpha = 1;
  }
}

function guardColor(guard) {
  if (guard.stance === GuardStance.Reinforce) {
    return COLORS.guardRelief;
  }

  if (guard.alert === AlertState.Alerted) {
    return COLORS.guardAlerted;
  }

  return guard.alert === AlertState.Suspicious ? COLORS.guardSuspicious : COLORS.guard;
}

function drawGuards() {
  const cell = scale();

  for (const guard of state.garrison.guards) {
    const x = guard.position.x * cell;
    const y = guard.position.y * cell;

    context.fillStyle = guardColor(guard);
    context.beginPath();
    context.arc(x, y, Math.max(2.5, guard.bodyRadius * cell), 0, Math.PI * 2);
    context.fill();

    // A short whisker for facing: which way a guard looks is the whole game.
    context.strokeStyle = guardColor(guard);
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + guard.facing.x * cell * 0.9, y + guard.facing.y * cell * 0.9);
    context.stroke();
  }
}

function drawParty() {
  const cell = scale();
  const mission = state.mission;

  // A body is drawn at its true size or a floor, whichever is bigger: on a map
  // this wide a quarter-tile radius is a pixel and a half, and a party you
  // cannot find on the canvas is not a debug view.
  const body = (radius) => Math.max(3, radius * cell);

  for (const ally of state.allies) {
    context.fillStyle = ally.isAlive ? COLORS.ally : COLORS.allyDown;
    context.beginPath();
    context.arc(ally.position.x * cell, ally.position.y * cell, body(ally.bodyRadius), 0, Math.PI * 2);
    context.fill();
  }

  const princess = mission.princess;
  context.fillStyle = COLORS.princess;
  context.beginPath();
  context.arc(princess.position.x * cell, princess.position.y * cell, cell * 0.45, 0, Math.PI * 2);
  context.fill();

  if (!princess.rescued) {
    context.strokeStyle = COLORS.princess;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(princess.position.x * cell, princess.position.y * cell, cell * 1.4, 0, Math.PI * 2);
    context.stroke();
  }

  const player = state.player;
  const px = player.position.x * cell;
  const py = player.position.y * cell;

  context.fillStyle = player.isAlive ? COLORS.player : COLORS.allyDown;
  context.beginPath();
  context.arc(px, py, body(player.radius * 1.3), 0, Math.PI * 2);
  context.fill();

  // A ring, so you can find yourself in the open ground at a glance.
  context.strokeStyle = COLORS.player;
  context.globalAlpha = 0.5;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(px, py, body(player.radius) + 5, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 1;
}

/** The alert meter, and the four ward alarms feeding it. */
function drawAlert() {
  const width = canvas.width;
  const barHeight = 10;
  const alert = state.garrison.alertLevel;

  context.fillStyle = "rgba(15, 23, 42, 0.85)";
  context.fillRect(0, 0, width, barHeight * 2 + 10);

  context.fillStyle = alert > 0.7 ? "#f87171" : alert > 0.35 ? "#fbbf24" : "#4ade80";
  context.fillRect(4, 4, (width - 8) * alert, barHeight);

  const wards = state.castle.wardList;
  const slot = (width - 8) / wards.length;

  wards.forEach((ward, index) => {
    const level = state.garrison.alarmIn(ward.id);
    context.fillStyle = "rgba(148, 163, 184, 0.2)";
    context.fillRect(4 + index * slot, barHeight + 8, slot - 4, barHeight - 4);
    context.fillStyle = state.garrison.alarmed.has(ward.id) ? "#f87171" : "#94a3b8";
    context.fillRect(4 + index * slot, barHeight + 8, (slot - 4) * level, barHeight - 4);
  });
}

function render() {
  drawTiles();
  drawBuffer();

  if (ui.patrols.checked) {
    drawPatrols();
  }

  if (ui.vision.checked) {
    drawVision();
  }

  drawVectors();
  drawGuards();
  drawParty();
  drawAlert();

  updateStatus();
}

const PHASE_LABEL = {
  [MissionPhase.Infiltrate]: "reach the princess",
  [MissionPhase.Extract]: "get her out",
  [MissionPhase.Complete]: "away clean",
  [MissionPhase.Regrouping]: "beaten back — regrouping",
};

function updateStatus() {
  const snapshot = state.mission.snapshot();
  const seenBy = state.garrison.guards.filter((guard) =>
    canSee(guard, state.player.position, state.castle.map, state.garrison.params),
  ).length;

  ui.status.textContent = [
    `seed ${state.seed}`,
    PHASE_LABEL[snapshot.phase],
    `${snapshot.style} run`,
    `alert ${(snapshot.alert * 100).toFixed(0)}%`,
    seenBy > 0 ? `SEEN by ${seenBy}` : "unseen",
    `${snapshot.garrison.guards} guards, ${snapshot.garrison.squads} relief on the move`,
    `attempt ${snapshot.attempts}`,
    state.paused ? "paused" : "running",
  ].join(" · ");

  ui.notice.textContent = state.noticeTimer > 0 ? state.notice : "";

  const events = [...state.mission.events, ...state.garrison.events]
    .sort((a, b) => b.at - a.at)
    .slice(0, 6)
    .map((event) => `${event.at.toFixed(0)}s ${event.type}`);

  ui.log.textContent = events.join("  ·  ");
}

/** The castle's own account of itself: what ways in this seed produced. */
function renderVectorList() {
  const rows = state.castle.candidateVectors().map((edge) => {
    const status = edge.isActive ? "live" : "not this castle";
    return `<li${edge.isActive ? "" : ' class="cold"'}>
      <b style="color:${VECTOR_COLOR[edge.vectorType]}">${edge.vectorType}</b>
      — ${edge.traversalType}, ${edge.justificationTag} · ${status}
      <span class="note">${edge.note}</span>
    </li>`;
  });

  ui.vectors.innerHTML = rows.join("");
}

function frame(timestamp) {
  const elapsed = state.lastFrame === 0 ? 0 : (timestamp - state.lastFrame) / 1000;
  state.lastFrame = timestamp;

  if (!state.paused) {
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
  rebuild(Number.isFinite(seed) ? seed : 0);
});

ui.pause.addEventListener("click", () => {
  state.paused = !state.paused;
  ui.pause.textContent = state.paused ? "Resume" : "Pause";
});

window.addEventListener("keydown", (event) => {
  if (event.key === "e" || event.key === "E") {
    interact();
  }
});

rebuild(0);
window.requestAnimationFrame(frame);
