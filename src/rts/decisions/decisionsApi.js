/**
 * Client for decision models — Jev and anything that speaks its API.
 *
 * A decision model does not write text. It is sent the application's state and
 * a set of typed questions, and it answers each one with a typed value and the
 * probabilities behind it: a `choice` picks one of the options it was given, a
 * `noul` is a probability that something is true, a `score` places the state
 * on an ordered scale. That is the shape of a strategic call in an RTS — "of
 * these four neighbouring regions, where does this army go?" — answered in the
 * time a frame budget can tolerate rather than the time a chat model takes.
 *
 * The request and response shapes are OpenRouter's Decisions API
 * (`POST /api/alpha/decisions`). Every provider in this directory — the remote
 * one here and the local heuristic — takes and returns exactly those shapes, so
 * a faction's commander does not know or care which one is answering. Pointing
 * {@link createDecisionModelProvider} at another endpoint that implements the
 * same API (an open-weights model served locally, say) needs no other change.
 */

export const OPENROUTER_DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const DEFAULT_DECISION_MODEL = "typesafe/jev-1.13";

export const QuestionType = Object.freeze({
  CHOICE: "choice",
  NOUL: "noul",
  SCORE: "score",
});

/** Thrown for any failure to get usable answers from a provider. */
export class DecisionError extends Error {
  constructor(message, { status = null, cause = undefined } = {}) {
    super(message, { cause });
    this.name = "DecisionError";
    this.status = status;
  }
}

/**
 * Checks one answer against the question that asked for it.
 *
 * Follows the API's own advice: check `type` before reading anything, treat a
 * missing or mistyped answer as an error rather than a default, and read the
 * optional fields (`probabilities`, `confidence`) through a presence check.
 *
 * @returns {object|null} the answer, or `null` when it cannot be trusted.
 */
export function validateAnswer(question, answer) {
  if (!answer || typeof answer !== "object" || answer.type !== question.type) {
    return null;
  }

  switch (question.type) {
    case QuestionType.CHOICE:
      return typeof answer.choice === "string" && Object.hasOwn(question.criteria, answer.choice) ? answer : null;
    case QuestionType.NOUL:
      return Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1 ? answer : null;
    case QuestionType.SCORE: {
      const top = Array.isArray(question.criteria) ? question.criteria.length - 1 : Infinity;
      return Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= top ? answer : null;
    }
    default:
      return null;
  }
}

/**
 * Splits a response into the answers that can be used and the question ids
 * that came back missing or malformed.
 */
export function collectAnswers(request, response) {
  const answers = {};
  const rejected = [];
  const received = response && typeof response.answers === "object" ? response.answers : {};

  for (const [id, question] of Object.entries(request.questions)) {
    const answer = validateAnswer(question, received[id]);
    if (answer) {
      answers[id] = answer;
    } else {
      rejected.push(id);
    }
  }

  return { answers, rejected };
}

/**
 * A provider backed by a remote decision model.
 *
 * @param {object} options
 * @param {string} options.apiKey Bearer token for the endpoint.
 * @param {string} [options.model] Decision model id, e.g. `typesafe/jev-1.13`.
 * @param {string} [options.endpoint] Any URL implementing the Decisions API.
 * @param {number} [options.timeoutMs] Abort a call that takes longer than this.
 * @param {typeof fetch} [options.fetchImpl] Injected for tests.
 */
export function createDecisionModelProvider({
  apiKey,
  model = DEFAULT_DECISION_MODEL,
  endpoint = OPENROUTER_DECISIONS_ENDPOINT,
  timeoutMs = 10000,
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    kind: "model",
    name: model,

    async decide(request) {
      if (!apiKey) {
        throw new DecisionError("No API key set for the decision model.");
      }
      if (typeof fetchImpl !== "function") {
        throw new DecisionError("No fetch implementation is available.");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let httpResponse;

      try {
        httpResponse = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...request, model }),
          signal: controller.signal,
        });
      } catch (error) {
        const reason = error?.name === "AbortError" ? `timed out after ${timeoutMs} ms` : error?.message ?? String(error);
        throw new DecisionError(`Decision request failed: ${reason}`, { cause: error });
      } finally {
        clearTimeout(timer);
      }

      if (!httpResponse.ok) {
        let detail = "";
        try {
          detail = (await httpResponse.text()).slice(0, 300);
        } catch {
          // The status code is enough to go on.
        }
        throw new DecisionError(`Decision model returned HTTP ${httpResponse.status}${detail ? `: ${detail}` : ""}`, {
          status: httpResponse.status,
        });
      }

      try {
        return await httpResponse.json();
      } catch (error) {
        throw new DecisionError("Decision model returned a body that is not JSON.", { cause: error });
      }
    },
  };
}
