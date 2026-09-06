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
| 6. Muster point | `generate.js` | where the party forms up, chosen by measuring the result |

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
- **Corner towers hold the apron in view**, so the ground under the walls is not free — and no
  further than the apron, which is what leaves the buffer beyond it unwatched.
- **Every ward is walkable end to end.** A building is placed only if the ward it stands in is
  still one connected piece afterwards; otherwise the placement is rolled back and retried.

### Two bands of open ground

The ground outside the walls is not one undifferentiated field. It is two bands, and both are
sized from the longest range anyone in the castle can see, rather than from the map:

```
map edge                                                          the castle
   |                                                                   |
   |<-------- buffer --------->|<-------- apron -------->|<-- curtain --
   |        ~15 tiles          |       ~20 tiles         |
   |                           |                         |
   |   nobody walks it         |   patrol circuits       |
   |   nobody can see          |   tower watch reaches   |
   |   across it               |   this far and no more  |
   |                           |                         |
   @ the party musters here,   |                         |
     ~6 tiles in               |                         |
```

The **apron** is the ground the garrison walks: swept by patrol circuits, held in view from the
corner towers, and the reason crossing open ground is the dangerous part of an approach.

The **buffer** is what lies beyond it, and it exists because a garrison's attention has an edge.
Two rules size it, and both are about eyesight rather than about the player:

- the apron is deeper than a tower can see, so tower watch cannot reach past it at all;
- the buffer is deeper again, so even a patrol walking the apron's outer edge cannot see across it.

Nothing occupies the buffer but the party. Patrol planning is masked to the apron, so no beat
walks out into it; outbuildings are placed on the apron only; and a ward's strength is sized from
the ground it patrols rather than from the whole ward, so a wider field does not conjure up more
men to wander it. This is why the map has to be as big as it is — the buffer is a consequence of
how far the garrison can see, and the castle needs room to sit inside it.

Measured on the default map with nobody intruding: the share of buffer tiles that any guard could
see, by distance in from the map edge, facing ignored.

| Tiles in from the map edge | 1–5 | 6 | 8 | 10 | 12 | 13 |
| --- | --- | --- | --- | --- | --- | --- |
| Any guard could see it | 0% | 2% | 6% | 10% | 12% | 14% |

The outer third of the buffer is ground nobody can see into at all, and visibility only reaches
14% at the inner edge where the buffer meets the apron. Across the whole band it is about 5%.

### Where the party starts

The muster point is chosen last, and by measuring the castle that was actually generated rather
than by formula: "can anybody see this spot" is a fact about where this particular garrison ended
up standing, and is only knowable once it is standing there.

Being out of sight is tested without regard to facing. A sentry who happens to have his back
turned when the castle is generated is not cover — he will turn round. What counts is whether he
*could* see it: within his range, with nothing in the way. Of the spots that pass, the scoring
prefers one well inside the buffer rather than on its boundary, comfortably clear of any beat,
and then, among those, the one with the shortest walk to the castle — because past a point,
further out is not safer, only slower.

On the default map that lands the party six tiles into the buffer, unseen by any of the
forty-nine guards, with the nearest of them twenty to twenty-seven tiles away.

### The castle itself

A generated castle at 112×112, seed 3, drawn at one character per two tiles. `#` masonry, `T`
tower, `B` building, `+` gate, `p` postern, `k` delivery door, `w` weathered curtain, `P` the
princess, `@` where the party musters. Dots are the apron; blank is the buffer.

```
########################################################
#                                                      #
#                                                      #
#                                                      #
#                          @                           #
#                                                      #
#                                                      #
#      ..........................................      #
#      ..........................................      #
#      ..................................BBBBB...      #
#      ..........................................      #
#      ..........................................      #
#      ..........................................      #
#      ..........................................      #
#      ..........................................      #
#      ..........................................      #
#      .........TT....................TT.........      #
#      .........TT#########T+T########TT.........      #
#      ..........##########T+T#########..........      #
#      ..........##............BBBB..##..........      #
#      ..........##BBBB........BBBB..##..........      #
#      ..........##BBBB........BBBB..##..........      #
#      ..........##BBBB..............##..........      #
#      ..........##..................##..........      #
#      ..........##.....########.....##..........      #
#      ..........##.....#......#.....##..........      #
#      ..........##.....D.####.+.....##..........      #
#      ..........##.....#.#.P#.+.....##..........      #
#      ..........##.....#.+..#.#.....##......BBB.      #
#      ..........##.....#.####.#.....##......BBB.      #
#      ..........##.BBB.#......#.....##......BBB.      #
#      ..........##.BBB.########.....##..........      #
#      ..........##.BBB..............##..........      #
#      ..........##.BBB..............##..........      #
#      ..........##.....BBBBB........##..........      #
#      ..........##BB...BBBBB........##..........      #
#      ..........##BB...BBBBB........##..........      #
#      ..........##p###ww#k############..........      #
#      .........TT#p###ww#k###########TT.........      #
#      .........TT....................TT.........      #
#      ..........................................      #
#      ..........................................      #
#      ..........................................      #
#      ..........................................      #
#      .....................................BBB..      #
#      .....................................BBB..      #
#      .....................................BBB..      #
#      ..........................................      #
#      ..........................................      #
#                                                      #
#                                                      #
#                                                      #
#                                                      #
#                                                      #
#                                                      #
########################################################
```

The outer gate is south, the inner gate north, the keep door south again — no straight
line from open ground to the objective. Four weak points are live on this seed: a postern,
a weathered stretch and a delivery door in the south curtain, and a sergeant on a door in
the inner one.

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
longest clear window? (Default map, seed 0, 49 guards, two minutes of simulation.)

| Way in | Watched | Longest clear window |
| --- | --- | --- |
| Main gate | 100% | 0.0s |
| Inner gate | 100% | 0.0s |
| Keep door | 99% | 0.5s |
| Weathered curtain | 66% | 2.9s |
| Delivery door | 32% | 6.1s |
| Postern | 18% | 7.6s |
| Sergeant's door | 11% | 71.6s |

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

**Standing the party up outside the front gate.** The muster point started as a fixed offset from
the outer gate — four tiles out, on the gate's own side. It reads fine on a map and is indefensible
in play: it is inside the gatehouse sentries' cone and well inside tower range, so a run began with
the castle already looking at you and the first thing that happened was an alarm. Worse, it made
the opening move meaningless — there was nothing to decide, because being seen had already
happened. Hence the buffer, the apron, and choosing the spot by measuring what the garrison can
actually see rather than by measuring from the gate.

**Approach patrols that walked to the map edge.** Interest points for a ward were taken from the
ward's bounding box, and the open ground's bounding box is the whole map — so circuits went out to
the corners and there was no unwatched ground anywhere outside the walls, however big the map got.
Masking approach patrol planning to the apron is what turned the far band into a buffer; making
the map bigger on its own did nothing at all.

**Sizing the garrison from the ward.** With the map enlarged, the open ground's tile count tripled
and the density rule dutifully produced three times as many men to wander a field. A ward's
strength comes from the ground it actually patrols now, so a wider buffer costs the castle
nothing and changes no other number.

**Testing "can anybody see the spawn" with the vision cone.** Using the same facing-aware check
the guards use meant a spot counted as hidden because a sentry happened to be looking the other
way at the moment of generation — which lasts until he turns round. Two seeds in twelve put the
party in plain view of a tower that way. Sight for this purpose is range plus line of sight, and
facing is ignored.

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
| `Ward.garrison_density` | `Ward.garrisonDensity`, guards per 100 tiles of the ground it patrols |
| `Ward.patrol_routes` | `Ward.patrolRoutes`, circuits and chokepoint beats |
| `Edge.vector_type` | `WardEdge.vectorType` — gate, postern, kitchen, sewer, breach, bribe |
| `Edge.is_active` | `WardEdge.isActive`, decided per seed; `isOpen` is runtime state |
| `Edge.garrison_density_override` | `WardEdge.garrisonDensity` |
| `Edge.alert_sensitivity` | `WardEdge.alertSensitivity` |
| `Edge.justification_tag` | `WardEdge.justificationTag` |

Names are camelCase to match the rest of the project. `Castle.toJSON()` emits the whole thing as a
plain object, which is what the tests and the level browser read.
