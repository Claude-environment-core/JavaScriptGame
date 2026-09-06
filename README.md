# JavaScriptGame

[https://claude-environment-core.github.io/JavaScriptGame/](https://claude-environment-core.github.io/JavaScriptGame/)

Three vanilla-JavaScript browser prototypes:

- **`index.html`** — a squad simulation: deterministic world generation, A\* routing, and a
  formation that squeezes and spreads to fit the space it is moving through.
- **`castle.html`** — a procedurally generated castle to infiltrate or storm: four wards, a few
  justified ways in, and a garrison whose alarm spreads ward by ward.
- **`arena.html`** — a top-down arena prototype (collect cores, power the exit, escape).

Everything is plain ES modules with no build step and no runtime dependencies.

## Run locally

```bash
npm run serve         # python3 -m http.server 8000
```

Then open <http://localhost:8000/> for the squad simulation, <http://localhost:8000/castle.html>
for the castle, or <http://localhost:8000/arena.html> for the arena prototype.

## Test and record

```bash
npm test              # node --test tests/*.test.js
npm run record        # writes run recordings to recordings/
```

`npm run record` takes `--out <dir>` and `--every <n>` (record every nth tick). A recording holds
the map tiles, the route, per-tick agent positions and velocities, the formation's deformation
state, and the run's metrics — mean slot error, closest approach between agents, wall entries,
reassignments, coherence.

## How the squad moves

Agents do not flock. The formation is a **deformable virtual structure**: the group senses the
room it has, deforms one shared shape to fit, and each agent tracks a slot in that shape.
Collision avoidance is a constraint on that tracking, not a force competing with it.

`docs/deformable-virtual-structure.md` is the full design — why weighted-sum flocking cannot hold
a formation, how the deformation works, and what was tried and rejected along the way.

The short version:

- **Narrowing lengthens.** `sy = 1/sx` preserves the formation's area, so a wedge entering a
  corridor stretches toward a file continuously rather than by special case. When narrowing runs
  out, the shape degrades — a wedge becomes a column — with hysteresis so it does not flicker.
- **Body radius is the primary constant.** Personal space, wall clearance, corridor margins and
  the limit on how far a formation may squeeze are all derived from it.
- **Slots hang off a spine** — the path the anchor actually travelled — so a file bends around
  corners instead of reaching its trailing slots through walls.
- **The squad slows for stragglers**, gated on formation coherence, but never stops: an agent that
  loses sight of its slot routes back to it.
- **Constraints project, they do not push.** A wall removes only the velocity component that would
  enter it, so it cannot be outvoted by a larger pull.

### Layout

| Module | Contents |
| --- | --- |
| `src/sim/vec2.js` | Vector math |
| `src/sim/rng.js` | Deterministic PRNG (mulberry32) |
| `src/sim/gridMap.js` | Tile map, transforms, neighbours, DDA raycast, line of sight |
| `src/sim/priorityQueue.js` | Binary min-heap with decrease-key |
| `src/sim/pathfinding.js` | A\* with a euclidean heuristic |
| `src/sim/worldGen.js` | Deterministic binary-partition world generation |
| `src/sim/agent.js` | Agent state, roles, body radius |
| `src/sim/player.js` | Player entity and keyboard controller for the sim view |
| `src/sim/squad.js` | Squad plan, route planning, controller factory |
| `src/sim/formation/` | The deformable virtual structure — see the design doc |
| `src/sim/snapshot.js` | Run recording and metrics |
| `src/sim/main.js` | Canvas front end for `index.html` |

## The castle

A castle generated from a seed, which a small group can sneak into or fight through, ending in
getting the princess out of the keep.

The rule the generator follows is that it does not build a castle with a hole in it. It builds a
castle that defends itself — continuous curtain walls, a gatehouse, an inner gate that is never on
the same side as the outer one, a keep door facing away from the inner gate, so there is no
straight run from open ground to the objective — and then cuts into it a few weak points that the
castle itself needs in order to work.

`docs/castle-generation.md` is the full design.

The short version:

- **Weak points are justified, not provided.** A sally gate by the cistern, a delivery door on the
  kitchen's timetable, a covered drain, a settled stretch of curtain, a sergeant with debts. Five
  candidates per castle, two to four switched on, never all of them — and an inactive one leaves
  the wall solid, with no tell.
- **The main gate is always crossable**, so every seed is solvable without any weak point at all.
  What the alarm can do is make the storm expensive, never impossible: anything shut can be
  forced, slowly and loudly.
- **Difficulty is the garrison, not the geometry.** A sighting becomes a shout, enough shouting
  raises the ward, the ward tells its neighbours, and the wards behind it send a relief column —
  which marches under the same formation controller the player's squad uses. Every link decays, so
  the chain can be interrupted anywhere.
- **The alert is the difficulty curve.** Quiet ways in are barred above a threshold, the keep is
  sealed, and relief columns grow and arrive sooner. All of it reverses on the way back down.
- **Losing is recoverable.** A beaten party falls back to the rally point and can go again against
  a castle that is still awake.

Measured on one castle with nobody intruding: the gates are in somebody's view 84–100% of the
time, while the postern and the delivery door have clear windows of six to eight seconds that
recur. That gap is the stealth game, and it is a property of where the guards walk rather than a
concession in the level.

### Layout

| Module | Contents |
| --- | --- |
| `src/castle/wards.js` | The ward graph: wards, chokepoints, and queries over them |
| `src/castle/layout.js` | Tile geometry — rings, gates, towers, buildings |
| `src/castle/vectors.js` | The weak-point catalogue, and which ones a seed switches on |
| `src/castle/patrol.js` | Patrol routes, path following, guard movement |
| `src/castle/garrison.js` | Guards, sight, the alert chain, relief columns |
| `src/castle/mission.js` | Objectives, what the alert costs, retreat and regroup |
| `src/castle/generate.js` | The pipeline, and an audit of what came out |
| `src/castle/main.js` | Canvas front end for `castle.html` |

## Known limits

- **Role behaviour is a placeholder.** Roles and agent states are carried on agents but no combat,
  recon or support logic exists.
- **One squad at a time.** Two formations meeting head-on in a corridor will not yield to each
  other; personal space keeps them from overlapping and both slow down.
- **Formation size is not chosen for you.** A file of five spans six tiles, so in a world of short
  corridors a large squad spends most of its time in single file.
- **The castle is a single layer.** Wall-top routes, tower interiors and keep floors are deferred;
  the ward graph carries a `level` and ignores it, so they are new nodes rather than a redesign.
- **Being caught is attrition, not combat.** There is no combat model in the project, so an
  alerted guard within reach simply wears a party member down — enough that being caught matters,
  and deliberately not enough to be mistaken for a fight.
