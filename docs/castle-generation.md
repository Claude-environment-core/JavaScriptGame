# Procedural Castle Generation

A castle a small group can sneak into or storm, generated from a seed. This document is both the
design and the record of building it, including the parts that were tried and thrown away.

---

## 1. The thing to avoid

The obvious way to generate an infiltration level is to generate a castle and then put a hole in
it. It is quick, it always works, and it is dead on arrival: the player learns in one run that the
level will provide a way in, and every castle afterwards is the same castle with the furniture
moved.

The problem is not that there is a way in. Real castles had several. The problem is that a hole
put there *for the player* has no reason to exist, so it teaches nothing, rewards nothing, and
cannot be reasoned about. You cannot deduce where it is, because it was not put anywhere for a
reason.

> **Generate a castle that defends itself. Then cut weak points into it that the castle itself
> needs.** Difficulty comes from the garrison's reaction, which is learnable; it does not come
> from geometry giving up early, which is not.

Everything below follows from that.

---

## 2. The pipeline

Five stages, drawing from one seeded stream in a fixed order, so a castle is fully reproducible
from its seed — the same contract world generation makes in the squad simulation.

| Stage | Module | Produces |
| --- | --- | --- |
| 1. Tile geometry | `layout.js` | rings, gates, towers, buildings, the princess, the rally point |
| 2. Ward graph | `wards.js` | four wards over that geometry, and the edges between them |
| 3. Entry vectors | `vectors.js` | 3–5 candidate weak points, a subset switched on |
| 4. Patrols | `patrol.js` | circuits per ward, beats at chokepoints |
| 5. Garrison | `garrison.js` | guards posted to those routes, and the alert machinery |

`generate.js` runs them in that order and audits the result. `mission.js` sits on top: objectives,
what the alert costs you, and what happens when you lose.

The ward graph is the load-bearing abstraction. Reinforcement routing, "how deep has the intruder
got", "which way is out" and "who defends this door" are all queries on a four-node graph, not
searches over 9,216 tiles.

---

## 3. What the geometry guarantees

Nothing in stage 1 leaves a gap. The tests in `tests/castleLayout.test.js` assert each of these
across a run of seeds:

- **Curtain rings are continuous.** Every walkable tile on a ring's perimeter belongs to a
  chokepoint. There are no accidental gaps, ever.
- **The inner gate is never on the same side as the outer gate.** Taking the front door does not
  put you on a straight run to the keep; it puts you in a bailey you have to cross lengthwise,
  under the walls, to reach the next door.
- **The keep door faces away from the inner gate**, for the same reason, one ward further in.
- **The main gate is set in a gatehouse**, flanked by towers.
- **Corner towers hold the approach in view**, so open ground is not free.
- **Every ward is walkable end to end.** A building is placed only if the ward it stands in is
  still one connected piece afterwards; otherwise the placement is rolled back and retried.

A generated castle at 64×64, seed 3. `#` masonry, `T` tower, `B` building, `+` gate, `p` postern,
`k` delivery door, `w` weathered curtain, `s` drain, `P` the princess:

```
################################################################
#..............................................................#
#..............................................................#
#..............................................................#
#.........................BBBBB................................#
#.........................BBBBB................................#
#..............................................................#
#......TTT............................................TTT......#
#......TTT............................................TTT......#
#......TTT#####kk#####################p###############TTT......#
#........######kk#####################p################........#
#........##..........................................##........#
#........##.BBBBBBBB.................BBB.............##........#
#........##.BBBBBBBB.................BBB.............##........#
#........##.BBBBBBBB.................BBB.............##........#
#........##.BBBBBBBB.................BBB.............##........#
#........##..........................................##........#
#........##......##############++##############......##........#
#........##......#............................#......##........#
#........##......#............................#......##........#
#........##......#......BBBB..................#......##........#
#........##......#......BBBB..................#......##........#
#........##......#......BBBB..................#.....TTT........#
#........##......#......BBBB..................#.....TTT........#
#........##......#......BBBB..................#......++........#
#........ww......#............................#......++........#
#........ww......#.......#################....#.....TTT........#
#........ww......#.......#...............#....#.....TTT........#
#........##......#.......#...............#....#......##........#
#......############......#...............#....#......##........#
#......ssssssssssss......#...............#....#......##........#
#......############......#...............#....#......##........#
#........##......#.......#...............#....#......##........#
#........##......#.......#...............#....#......##........#
#........##......#.......#.............P.#....#......##........#
#........##......#.......#...............#....#......##........#
#........##......#.......#...............#....#......##........#
#........##......#.......#####+###########....#......##........#
#........##......#............................#......##........#
#........##......#............................#......##........#
#........##......#............................#......##........#
#........##..BBBB#............................#......##........#
#........##..BBBB#............................#......##........#
#........##..BBBB#............................#......##........#
#........##..BBBB#............................#......##........#
#........##..BBBB#............................#......##........#
#........##..BBBB##############################......##........#
#........##..BBBB....................................##........#
#........##.........................BBBBB............##........#
#........##.........................BBBBB............##........#
#........##.........................BBBBB............##........#
#........##.........................BBBBB............##........#
#........##..........................................##........#
#........##############################################........#
#......TTT############################################TTT......#
#......TTT............................................TTT......#
#......TTT............................................TTT......#
#..............................................................#
#..............................................................#
#..............................................................#
#..............................................................#
#..............................................................#
#..............................................................#
################################################################
```

The outer gate is east, the inner gate north, the keep
door south — three sides, no straight line. Four weak points are live on this seed: a postern and
a delivery door in the north curtain, a weathered stretch in the west curtain, and a drain running
under the outer bailey into the inner ward.

---

## 4. Weak points

Five kinds, each justified by something the castle needs in order to work. The justification is
not flavour text: it decides where the vector can be, who watches it, and what it costs.

| Kind | Justified by | Traversal | Where it comes out | The trade |
| --- | --- | --- | --- | --- |
| Postern | the cistern needs water | stealth | outer bailey | lightly held, and a long way from the keep |
| Delivery door | the kitchen takes deliveries | stealth | outer bailey | open only while the carts run |
| Drain | the castle has to drain | stealth | **inner bailey** | slow, cramped, no way back if you are found |
| Weathered curtain | foundations settle | combat | outer bailey | loud enough that everyone hears it |
| Corruptible sergeant | guards are people | puzzle | inner bailey | he will not take money once the alarm is up |

Each carries `location`, `garrisonDensity`, `alertSensitivity`, `traversalType`, `justificationTag`
and a `{time, noise, risk}` cost profile. `time` is scaled by how far that way in leaves you from
the princess, so a quiet door on the far side is quiet *and* long.

Two rules keep this honest:

- **Never all of them.** Five candidates are generated; two to four are switched on, and at least
  one is always left cold. Knowing the catalogue is not knowing the level.
- **An inactive candidate leaves no trace.** The wall it would have pierced is solid, and nothing
  on the map is attributed to it. There is no visual tell.

Over 60 seeds: postern 45, breach 41, drain 34, delivery door 31, sergeant 27; two live at once on
24 seeds, three on 14, four on 22.

### The gate is not a weak point

All three gates are always crossable. This is what makes every seed solvable without any weak
point at all — the storm path is the floor under the level. What the alert can do is make it
expensive (§6), never make it disappear.

### Measured: is there a way through?

With nobody intruding, how often is each way in actually in somebody's view, and what is the
longest clear window? (96×96, seed 0, 41 guards, two minutes of simulation.)

| Way in | Watched | Longest clear window |
| --- | --- | --- |
| Main gate | 84% | 0.3s |
| Inner gate | 100% | 0.0s |
| Keep door | 98% | 0.2s |
| Weathered curtain | 64% | 2.9s |
| Delivery door | 25% | 6.3s |
| Postern | 15% | 7.7s |

That table is the level design. The gates are watched, so the front door means being seen. The
quiet ways in have windows of several seconds that recur, which is a timing game a player can
learn by watching. The drain has nobody on it at all — because nobody posts a man on a drain — and
pays for that by surfacing in the most heavily patrolled ward in the castle.

---

## 5. The garrison

A chain, with a decay on every link, so the player can interrupt it anywhere:

```
guard sees something   →   he shouts, and the men in earshot go and look
                       →   enough alerted men raise the ward's alarm
                       →   the alarm spreads to the wards next door
                       →   the wards behind it send a relief column
```

- **Sight** is a range, a 120° cone and a line-of-sight test. **Shouting** ignores facing and
  walls: sound is not sight, which is how an alarm crosses a ward boundary before any bell rings.
- **A single jumpy guard is not an alarm.** A ward goes loud when about a third of its strength is
  alerted at once, scaled by the ward's own sensitivity.
- **Castle alert is half the worst ward and half a depth-weighted average.** Both halves are
  needed: without the first, a real alarm in one place reads as a calm castle; without the second,
  a scuffle in a field reads the same as men fighting in the keep.
- **Relief comes from deeper in, never from the field**, and a ward never sends more than half its
  strength. Stripping the keep to chase a noise in the outer bailey is exactly the mistake a
  castle is built not to make.
- **Columns march under the formation controller** from `src/sim/formation` — the same deformable
  virtual structure the player's own squad uses. A relief column coming through a gate behaves the
  way the player's squad does going the other way, and it narrows into a file in a corridor for
  the same reasons.
- **Men go home.** A guard with nothing left to investigate walks back to his own ward. Without
  this the castle bleeds: every column that marches out to a noise leaves men where the noise was,
  and a few alarms later the keep is held by nobody.

Density rises with depth — the keep is held around four times as hard per tile as the outer
bailey — and chokepoints are manned on top of that, from each crossing's own density. So a castle
with more live weak points has more men standing in them: an extra way in costs the garrison
something, which is a property that fell out of the model rather than being written into it.

---

## 6. What the alert costs you, and losing

The geometry never changes with the player's skill. What changes is what the garrison does:

- **Quiet ways in get barred** above a threshold scaled by each vector's own sensitivity, and
  unbarred on the way back down.
- **The keep is sealed** at high alert.
- **Relief columns grow and come sooner**, interpolated on the alert level.
- **Anything shut can still be forced** — slowly, and loudly. This is the rule that keeps the
  storm path open against a castle that has woken up.
- **A door cannot be shut on someone standing in it.** The party only: the garrison can step
  aside to drop a bar, so counting its own sentries here would mean a guarded door could never be
  shut at all. Jamming a doorway is a move the *player* has.

A run is judged by the worst it ever got — stealth, contested or storm — measured at the peak, so
quietening down afterwards does not buy back a stealth run.

**Losing is a setback, not an ending.** A beaten party falls back to the rally point, patches up,
and goes again against a castle that is still awake and settling only slowly. That recoverability
is what makes a group willing to try a way in that might not work, which is the whole point of
generating several.

---

## 7. What was tried and thrown away

The useful half of the record.

**Placing buildings by sampling the ward's bounding box.** Most of that box is the next ward in,
where nothing can be built, so two thirds of the buildings simply failed to place. Sampling one of
the ring's four segments instead fixed the hit rate — and put buildings along the walls, which is
where a castle's ranges of buildings actually are. The bug had a better answer than the original
design.

**Checking ward connectivity naively after carving the drain.** The drain is a covered channel
walled off from the bailey it crosses; its own tiles are cut off from that ward *by design*. The
check counted them and rejected every drain, so for a while the drain existed in the catalogue and
never once appeared in a castle. The check has to exclude the channel and assert that the ring
*around* it survives.

**Posting a sentry on both sides of every door, out of the ward's patrol strength.** Gates ended
up double-manned while nobody walked the bailey. A door is manned from the defended side only —
the deeper of the two wards — and sentries are additional to patrol strength, not drawn from it.

**Posting that sentry in the doorway.** With a guard pacing two tiles beside a postern, no window
ever opened and stealth was arithmetically impossible. A weak point's guard walks the wall six
tiles either side instead, which leaves a recurring window; and a crossing whose density rounds to
nobody — the drain — gets no beat at all. The measured table in §4 is what that change bought.

**Castle alert as the worst ward.** A scuffle in a field read as an 0.89 castle-wide alert and
barred every postern in the castle. Depth-weighting the average half of the blend made an alarm
mean roughly what it should.

**Letting guards count as "someone standing in the doorway".** Sentries pace over their own
doorways constantly, so the delivery door could never be shut and the postern could never be
barred. The rule is about the party, not about everybody.

**Patrol routes straight from A\*.** Four-neighbour expansion turns a diagonal into a staircase, so
guards zig-zagged across open baileys in one-tile steps. String-pulling each leg to the furthest
cell still in line of sight — using the raycast that was already there for vision — cut a typical
circuit from forty-odd waypoints to under a dozen and made patrols walk like patrols. Sentry beats
had a worse version of the same fault: their ends were picked geometrically, so a beat could walk
straight through a building. They are pathed now, and a test asserts that no leg of any route
crosses anything solid.

---

## 8. Extending upward

The 2D scope note in the brief asks that the ward graph be extensible to a vertical axis without a
redesign. It is:

- `Ward` carries a `level`, which is 0 for every ward in the 2D castle, and every graph query
  ignores it. Wall-top walks and upper floors of the keep are new nodes at `level > 0`.
- `WardEdge` already describes a crossing between two wards with its own guard density,
  sensitivity, justification and cost. A stair or a ladder is another `vectorType`; nothing about
  alert propagation, reinforcement routing or the mission layer needs to know it goes up.
- Watchtowers are the one place the 2D projection shows. A tower is drawn as a solid block with a
  guard post at its foot on the approach side, standing in for the elevated sightline it really
  has. When the vertical pass lands, that post becomes a tile on the tower top at `level 1`,
  reached by a stair edge, and its role does not change.

---

## 9. The brief's data model, as built

| Brief | Code |
| --- | --- |
| `Castle.wards` | `Castle.wards`, a `Map` of id to `Ward` |
| `Ward.type` | `WardType.Approach` / `OuterBailey` / `InnerBailey` / `Keep` |
| `Ward.garrison_density` | `Ward.garrisonDensity`, guards per 100 walkable tiles |
| `Ward.patrol_routes` | `Ward.patrolRoutes`, circuits and chokepoint beats |
| `Edge.vector_type` | `WardEdge.vectorType` — gate, postern, kitchen, sewer, breach, bribe |
| `Edge.is_active` | `WardEdge.isActive`, decided per seed; `isOpen` is runtime state |
| `Edge.garrison_density_override` | `WardEdge.garrisonDensity` |
| `Edge.alert_sensitivity` | `WardEdge.alertSensitivity` |
| `Edge.justification_tag` | `WardEdge.justificationTag` |

Names are camelCase to match the rest of the project. `Castle.toJSON()` emits the whole thing as a
plain object, which is what the tests and the level browser read.
