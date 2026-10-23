import { QuestionType } from "./decisionsApi.js";

/**
 * A local stand-in for a decision model.
 *
 * It answers the same requests in the same response shape as Jev, so it can
 * play a faction on its own (no key, no network, fully deterministic — which is
 * what the tests and headless matches use), and it fills in for any question a
 * remote model failed to answer.
 *
 * It cannot read the prose in a request, so the commander hands it the numbers
 * behind each option alongside (`context.options`). It scores every option,
 * turns the scores into probabilities with a softmax, and picks the most
 * likely — the same `choice` + `probabilities` + `confidence` a model returns.
 */

const TEMPERATURE = 0.8;

/** Scores one army option. Higher is better; roughly, 1 is "worth doing". */
export function scoreOption(option) {
  const { strength } = option;

  if (option.kind === "hold") {
    if (option.contested) {
      // Stay in a fight we are winning; a fight we are losing is worth leaving.
      return option.ownHere >= option.enemyHere * 1.1 ? 2.5 : -1 + option.ownHere / Math.max(option.enemyHere, 0.1);
    }
    if (!option.owned) {
      return 3; // Mid-capture: finishing it is almost always right.
    }
    return option.threat > 0 ? 0.6 + Math.min(option.threat / Math.max(strength, 0.1), 1.5) : -0.2;
  }

  if (option.relation === "self") {
    const retreat = option.retreating ? 1.5 : 0;
    const guard = option.threat > 0 && option.garrison < option.threat ? 0.6 + option.income * 0.2 : -0.6;
    // Small armies that cannot win a fight alone are worth more joined up.
    const merge = option.friendlyThere > 0 ? 1.2 * Math.min(option.friendlyThere / Math.max(strength, 0.1), 1.5) : 0;
    // An army deep in home territory is wasted; walk it to where the fighting is.
    const advance = option.towardFront ? 0.9 : 0;
    return retreat + guard + merge + advance - option.friendlyBound * 0.1;
  }

  const advantage = strength / (option.defense * option.defenderBonus + 0.5);
  if (advantage < 1.2) {
    return -2 + advantage;
  }

  return (
    1 +
    option.income * 0.6 +
    (option.enemyCapital ? 2 : 0) +
    (option.relation === "neutral" ? 0.3 : 0) +
    Math.min(advantage, 3) * 0.2 -
    (option.friendlyBound > 0 ? 0.8 : 0)
  );
}

function softmax(scores) {
  const peak = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - peak) / TEMPERATURE));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

const round = (value) => Math.round(value * 1000) / 1000;

/** Answers a choice question from its options' features. */
export function answerChoice(options) {
  const keys = options.map((o) => o.key);
  const probs = softmax(options.map(scoreOption));
  let best = 0;
  for (let i = 1; i < probs.length; i += 1) {
    if (probs[i] > probs[best]) {
      best = i;
    }
  }
  const ordered = [...probs].sort((a, b) => b - a);

  return {
    type: QuestionType.CHOICE,
    choice: keys[best],
    probabilities: Object.fromEntries(keys.map((k, i) => [k, round(probs[i])])),
    confidence: round(ordered[0] - (ordered[1] ?? 0)),
  };
}

export function createHeuristicProvider() {
  return {
    kind: "heuristic",
    name: "heuristic",

    /**
     * @param {object} request A Decisions API request.
     * @param {object} context The commander's side channel: `options` keyed by
     *   question id, and `canRecruit`.
     */
    async decide(request, context) {
      return { model: "heuristic", answers: answerLocally(request, context), usage: { cost: 0 } };
    },
  };
}

/** Synchronous core, also used to fill in questions a remote model got wrong. */
export function answerLocally(request, context, onlyIds = Object.keys(request.questions)) {
  const answers = {};
  for (const id of onlyIds) {
    const question = request.questions[id];
    if (question.type === QuestionType.CHOICE) {
      answers[id] = answerChoice(context.options[id]);
    } else if (question.type === QuestionType.NOUL) {
      answers[id] = { type: QuestionType.NOUL, noul: context.canRecruit ? 0.95 : 0.05 };
    }
  }
  return answers;
}
