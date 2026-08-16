# JavaScriptGame

[https://claude-environment-core.github.io/JavaScriptGame/](https://claude-environment-core.github.io/JavaScriptGame/)

Two vanilla-JavaScript browser prototypes:

- **`simulation.html`** — a port of the **Simple3DPlayground** squad simulation: deterministic world
  generation, A\* routing, waypoint progression and flock steering, all in 2D.
- **`index.html`** — the earlier top-down arena prototype (collect cores, power the exit, escape).

Everything is plain ES modules with no build step and no runtime dependencies.

## Run locally

```bash
npm run serve         # python3 -m http.server 8000
```

Then open <http://localhost:8000/simulation.html> for the squad simulation, or
<http://localhost:8000/index.html> for the arena prototype. Opening the files directly also works in
browsers that allow ES modules from `file://`.

## Test and snapshot

```bash
npm test              # node --test tests/*.test.js
npm run snapshot      # writes snapshots/fixture-a.json and snapshots/fixture-b.json
```

`npm run snapshot` takes `--out <dir>` and `--every <n>` (record every nth tick). A snapshot holds the
map tiles, the A\* path, the world-space waypoints and per-tick agent positions and velocities — diff
two implementations' snapshots to find the first tick where they diverge.

## Simulation layout

| Module | Contents |
| --- | --- |
| `src/sim/vec2.js` | Vector math, including the local-to-world rotation used by formation offsets |
| `src/sim/rng.js` | Deterministic PRNG (mulberry32), seed `0` by default |
| `src/sim/gridMap.js` | Tile map, coordinate transforms, 4-neighbour iterator, DDA raycast, line of sight |
| `src/sim/priorityQueue.js` | Binary min-heap with decrease-key support |
| `src/sim/pathfinding.js` | A\* with unit step cost and a euclidean heuristic |
| `src/sim/worldGen.js` | Deterministic binary-partition generation, border walls, carved corridors |
| `src/sim/formations.js` | Wedge, Line, Column, Circle and Spread slot offsets |
| `src/sim/steering.js` | Steering parameters and the weighted behaviour composition |
| `src/sim/obstacleAvoidance.js` | 5-ray forward cone with grid-aware DDA stepping |
| `src/sim/agent.js` | Agent state, roles, config-driven health |
| `src/sim/squad.js` | Squad plan and the per-tick controller pipeline |
| `src/sim/snapshot.js` | Parity snapshot recorder |
| `src/sim-demo/main.js` | Canvas front end for `simulation.html` |

### Tick pipeline

Each tick, `SquadController.tick(dt)` runs the specified order: resolve the active waypoint, move the
formation anchor toward it at `FormationAnchorSpeed`, compute the centroid and the farthest-agent
distance, advance the waypoint **only** when the farthest agent is inside `GroupArrivalRadius`, build
formation slots (falling back to the anchor when the anchor cannot see the slot), assemble a frozen
flock context, compose steering per agent, then integrate:

```
v = clamp(v + steering * dt, MaxSpeed)
p = p + v * dt
```

Behaviours are evaluated in a fixed order — path attraction, separation, cohesion, alignment,
formation slot, obstacle avoidance, centroid push — and the weighted sum is clamped to
`MaxSteeringForce`. Defaults live in `DEFAULT_STEERING_PARAMS`; every value from the specification is
reproduced there verbatim.

## Parity fixtures

`tests/fixtures.js` builds the specification's fixtures by hand, so they hold regardless of RNG
differences between ports:

- **Fixture A** — 12×12 grid, one wall row with a single opening at `(5, 6)`. A path exists, traverses
  the opening, and all five agents finish within 2.0 of the goal (189 ticks at `dt = 0.1`).
- **Fixture B** — 14×16 grid, two sequential doorways at `(5, 3)` and `(8, 8)`. The path uses both, and
  all five agents finish within 2.0 of the goal (310 ticks).
- **Fixture C** — obstacle-avoidance sanity cases: absent map, open map, wall ahead, out-of-bounds
  heading, zero velocity, and closer-versus-farther wall strength.

## Known caveats

These are properties of the specified model, not port defects. They are covered by tests so a future
port can tell them apart from regressions.

- **Random-stream parity.** The specification fixes the seed (`0`) and the order of random draws, but
  not the generator itself. `DeterministicRandom` is mulberry32, so generated maps are reproducible
  within this implementation and across engines — but they will not match a port that uses a different
  PRNG. Fixtures A/B/C avoid generation entirely for exactly this reason.
- **Formations deeper than `GroupArrivalRadius` stall.** The waypoint gate needs the farthest agent
  within 2.5 units of the target. Five agents in a Column at the default 1.2 spacing span 4.8 units, so
  the gate never opens and the squad creeps. Keep the formation's extent inside the arrival radius —
  the demo uses 0.6 spacing for this reason.
- **Agents can clip thin walls.** The specified integration step has no collision response: agents are
  points steered only by obstacle avoidance, so when path attraction, cohesion and formation pull all
  point the same way, their combined weight can exceed avoidance and drag a straggler through a
  one-tile wall. Routing itself always respects walls. Adding hard collision was tried and rejected —
  without per-agent replanning it converts the clipping into agents stuck against walls, which fails
  the fixtures outright.
- **Role behaviour is a placeholder.** Roles and agent states are carried for data compatibility;
  combat, recon and support logic is not implemented, matching the source simulation.

## Arena prototype

The original `index.html` prototype is unchanged: move with `WASD` or the arrow keys, interact with `E`
or `Space`, collect every energy core, activate the switch console, then open and reach the exit.
