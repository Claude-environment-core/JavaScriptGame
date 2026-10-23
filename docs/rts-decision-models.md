# Strategy from a decision model

The RTS prototype ([`rts.html`](../rts.html), [`src/rts/`](../src/rts)) is four factions fighting
over a map of territories. Nothing in the game decides strategy. Each faction has a
**commander** that, every few seconds, describes the map from its side, asks a decision model a
handful of typed questions, and turns the answers into orders.

The model it is built against is **Jev**, TypeSafe's first "System One" model, served through
OpenRouter's Decisions API. A local heuristic answers the same questions in the same shape, so a
faction can run with no model at all, and anything a model fails to answer is filled in without a
pause.

## Why a decision model

A chat model asked "what should Crimson do?" writes an essay, which then has to be parsed back
into orders, and it takes seconds to do so. A decision model is asked a closed question and
answers it with a value and the probabilities behind it:

- `choice`: one of the options it was given, with a probability for each.
- `noul`: the probability that something is true.
- `score`: a position on an ordered scale.

That is already the shape of a strategic call in an RTS. "Of these four neighbouring regions,
where does army 7 go?" is a `choice`. "Do we spend the treasury now?" is a `noul`. The answer
cannot name a region that does not exist or an order the game does not have, because the options
are the request. It also comes back fast enough to make every few seconds for every faction.

This is the System 1 split. The model makes quick judgements about *what* to do, and the world's
rules decide what happens. Nothing the model says goes around the rules: an order is checked
against the world when it arrives, and dropped if it no longer fits.

## The game

The game's rules are deliberately small, so that the result comes from strategy rather than unit
micro-management. All of them are in [`world.js`](../src/rts/world.js), and every number is in
[`config.js`](../src/rts/config.js).

- **The map** ([`mapGen.js`](../src/rts/mapGen.js)) is a 64×64 tile grid. Value noise lays out
  mountains and water, and anything cut off from the largest piece of open ground is filled in.
  26 territories are then grown over the open ground by a multi-source flood fill. A territory
  therefore never spans a mountain range, and two territories are neighbours exactly when an army
  can walk between them. March routes between neighbouring rally points use the squad
  simulation's A\*. Capitals are chosen by farthest-point selection over hop distance.
- **Territory pays.** Each region has an income of 1–3. Gold raises new armies at the capital.
- **Territory supports armies.** A faction's total army strength is capped at 6× its income. This
  is the snowball. Without it, a four-way war with identical commanders never ends: armies grow
  without limit, and no faction pulls ahead (in testing, 1 of 20 matches was decided within 25
  minutes of game time; with the cap, 20 of 20 were, in about 9 minutes on average).
- **Armies fight where they stop.** Everything standing in a region fights at once: every army
  there, plus the owner's garrison. Each side loses strength in proportion to the enemy strength
  present, split across its enemies by share. The owner deals 1.3× damage. Armies on the march do
  not fight, and cannot be redirected until they arrive.
- **Taking ground takes time.** An army alone in a region it does not own captures it after 3
  uncontested seconds.
- **No mustering under siege.** A new army can only be raised in a region with no enemy army in
  it. Otherwise a besieged faction could reset a capture forever by recruiting inside its own
  capital, and in testing this happened.
- **Winning** means holding 75% of the regions, or being the last faction standing. Two armies
  of the same faction in one region merge.

## A decision round

[`commander.js`](../src/rts/decisions/commander.js) builds one request per faction per round. It
asks one question per idle army, plus one about the treasury when recruiting is possible:

```json
{
  "model": "typesafe/jev-1.13",
  "session_id": "rts-0-crimson",
  "state": {
    "you": "Crimson",
    "goal": "Take over the map: hold 20 of 26 regions, or be the last faction standing.",
    "rules": ["Regions pay income every second; …", "…"],
    "gold": 14.5, "army_strength": 8, "supply_cap": 18,
    "factions": [{ "name": "Azure", "regions": 3, "army_strength": 11.2, "…": "…" }],
    "regions": [{ "id": "r16", "name": "Dunmoor", "owner": "neutral", "income": 3,
                  "garrison": 4, "neighbors": ["r5", "r9"], "armies": [] }],
    "armies_on_the_march": []
  },
  "questions": {
    "army_1": {
      "type": "choice",
      "instructions": "Army 1 (strength 8) is at Marmoor. Choose its next order.",
      "criteria": {
        "hold": "Stay at Marmoor; nothing threatens it.",
        "r16": "Attack Dunmoor (neutral; income 3; defended by 4).",
        "r25": "Attack Thornfell (neutral; income 2; defended by 3)."
      }
    },
    "recruit": {
      "type": "noul",
      "instructions": "Spend 12 gold now to raise a new army of strength 6 at Marmoor?",
      "criteria": { "true": "Raise the army now.", "false": "Save the gold for later." }
    }
  }
}
```

The state is the whole map, because 26 regions fit easily: a typical request is about 5 KB. The
option descriptions repeat the numbers that matter for that move (defence, income, whose capital
it is, what threatens it, whether friendly armies are already heading there), so the model does
not have to join tables to answer.

A response is read the way the API's own reference advises. Every answer's `type` is checked
before anything else is read. A `choice` must be one of the options that were offered, and
`probabilities` and `confidence` are treated as optional ([`decisionsApi.js`](../src/rts/decisions/decisionsApi.js)).
An answer that is missing or malformed is rejected **per question**, and the heuristic answers that
question instead, so one bad answer does not cost the whole round. A failed call (no key, HTTP
error, timeout, non-JSON) costs the faction one round of judgement, all filled in by the heuristic.
Its armies are never frozen. Every round records which source answered each question: `model`,
`heuristic` or `fallback`.

Answers for armies that have since moved on are dropped. In the browser, the world keeps running
while a model thinks, so latency is part of the contest there. The headless runner works in
lockstep instead: the world waits for every round, so a match's outcome depends on the answers and
not on network speed.

## The heuristic

[`heuristic.js`](../src/rts/decisions/heuristic.js) cannot read prose, so the commander passes it
the numbers behind each option alongside the request. It scores each option:

- Attack what you can beat: strength over defence × defender bonus, needing a margin of 1.2. Weight
  by income, and more for an enemy capital.
- Finish a capture once it has started.
- Stay in a fight you are winning, and leave one you are losing.
- Guard home regions that are threatened.
- Merge small armies.
- Walk idle armies toward the front.

Scores become probabilities through a softmax, and the answer comes back in exactly the response
shape Jev uses. That makes it three things: the opponent a model plays against, the fallback when
a model fails, and the baseline a model has to beat.

Measured over 60 seeds with the heuristic commanding all four factions, the wins split 18 / 11 /
15 / 16. That is within noise for four seats, so the seats are roughly fair.

## Running it

- **In the browser**, open `rts.html`, paste an OpenRouter key, and set any faction's commander to
  **Jev**. The key is held in page memory only and sent only to the model endpoint. The side panel
  shows each round: the option chosen for every army, the top probabilities, latency, cost, and
  whether the answer was the model's or a fallback.
- **Headless**, run `OPENROUTER_API_KEY=… npm run rts-match -- --model-factions azure --matches 20`.
  This plays 20 seeds with Azure commanded by Jev and the rest by the heuristic. `--log rounds.jsonl`
  writes every round's questions and answers. Without `--model-factions` it is a heuristic-only
  tournament that needs no key.

Seeds vary a lot (capital position, terrain), so compare a model against the heuristic over many
seeds, and over more than one seat.

## Swapping in an open model later

The commander only knows the provider interface: `decide(request, context) → response` in the
Decisions API shape. `createDecisionModelProvider` takes an `endpoint` and a `model`. Any server
that implements the same `POST …/decisions` contract can therefore be used with no code change,
for example an open-weights model behind a Jev-compatible API, which some community projects
offer. The CLI exposes this as `--endpoint` and `--model`.

A model that cannot serve this API would need a provider of its own: about forty lines that map
the request to the model's input and its output back to `answers`. The heuristic is an example of
exactly that.

## Known limits

- **Not yet played against the live model.** The Jev client was written against OpenRouter's
  published Decisions API reference and exercised only against a mocked endpoint, in unit tests and
  in the browser. How well Jev plays, and how fast it answers, is still to be measured.
- **One question per army.** There is no joint planning, so two armies may each pick the same
  target without knowing about the other. Friendly armies already marching to a region are shown in
  the option text to soften this.
- **Armies do not fight on the march**, and two armies crossing on the same road pass through each
  other.
- **Only spectating.** No faction can be played by hand yet.
- **Armies are tokens.** The squad simulation's formation controller could march them as squads.
  It was left out to keep the strategic layer independent of it.
