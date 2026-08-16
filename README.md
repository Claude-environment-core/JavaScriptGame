# JavaScriptGame

[https://claude-environment-core.github.io/JavaScriptGame/](https://claude-environment-core.github.io/JavaScriptGame/)

Two vanilla-JavaScript browser prototypes:

- **`index.html`** — a squad simulation: deterministic world generation, A\* routing, and a
  formation that squeezes and spreads to fit the space it is moving through.
- **`arena.html`** — a top-down arena prototype (collect cores, power the exit, escape).

Everything is plain ES modules with no build step and no runtime dependencies.

## Run locally

```bash
npm run serve         # python3 -m http.server 8000
```

Then open <http://localhost:8000/> for the squad simulation, or
<http://localhost:8000/arena.html> for the arena prototype.

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
| `src/sim/squad.js` | Squad plan, route planning, controller factory |
| `src/sim/formation/` | The deformable virtual structure — see the design doc |
| `src/sim/snapshot.js` | Run recording and metrics |
| `src/sim-demo/main.js` | Canvas front end for `index.html` |

## Known limits

- **Role behaviour is a placeholder.** Roles and agent states are carried on agents but no combat,
  recon or support logic exists.
- **One squad at a time.** Two formations meeting head-on in a corridor will not yield to each
  other; personal space keeps them from overlapping and both slow down.
- **Formation size is not chosen for you.** A file of five spans six tiles, so in a world of short
  corridors a large squad spends most of its time in single file.
