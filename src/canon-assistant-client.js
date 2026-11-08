const ALLOWED_ENDPOINTS = new Set(["canonAssistantDev", "canonAssistant"]);
const ALLOWED_STATUSES = new Set([
  "answer",
  "not-found-in-canon",
  "conflict-in-canon",
  "restricted",
  "needs-clarification",
  "safety-escalation",
  "blocked",
  "rate-limited",
  "unavailable"
]);

const SAFE_NO_ANSWER = Object.freeze({
  status: "not-found-in-canon",
  answer: "The hosted response did not include verifiable source citations, so it was not shown.",
  grounding: "none",
  citations: []
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCitation(value) {
  if (!isPlainObject(value)) return null;
  const { documentId, title, section, pageStart, pageEnd } = value;
  if (typeof documentId !== "string" || !documentId.trim() ||
      typeof title !== "string" || !title.trim() ||
      typeof section !== "string" || !section.trim() ||
      !Number.isInteger(pageStart) || pageStart < 1 ||
      !Number.isInteger(pageEnd) || pageEnd < pageStart) return null;
  return Object.freeze({
    documentId: documentId.slice(0, 160),
    title: title.slice(0, 240),
    section: section.slice(0, 400),
    pageStart,
    pageEnd,
    ...(typeof value.excerpt === "string" && value.excerpt.trim()
      ? { excerpt: value.excerpt.slice(0, 1600) }
      : {})
  });
}

export function normalizeCanonAssistantResponse(callableResult) {
  const data = isPlainObject(callableResult?.data) ? callableResult.data : callableResult;
  if (!isPlainObject(data) || !ALLOWED_STATUSES.has(data.status)) return SAFE_NO_ANSWER;

  const answer = typeof data.answer === "string" ? data.answer.trim().slice(0, 8000) : "";
  const grounding = ["strong", "limited", "none"].includes(data.grounding) ? data.grounding : "none";
  const citations = Array.isArray(data.citations)
    ? data.citations.slice(0, 5).map(normalizeCitation).filter(Boolean)
    : [];

  // The callable contract promises citation-validated answers. Fail closed if it is violated.
  if (data.status === "answer" && (!answer || grounding === "none" || citations.length === 0)) {
    return SAFE_NO_ANSWER;
  }
  if (!answer) return SAFE_NO_ANSWER;

  return Object.freeze({
    status: data.status,
    answer,
    grounding,
    citations: Object.freeze(citations),
    requestId: typeof data.requestId === "string" ? data.requestId.slice(0, 100) : ""
  });
}

/**
 * Creates an opt-in adapter for the existing Firebase callable contract.
 * Firebase Auth/App Check are provided by the official SDK; tests inject a mock.
 * Dog profiles, session settings, prior turns, and feedback are deliberately not accepted.
 */
export function createCanonAssistantClient({
  enabled = false,
  endpointName = "",
  functions,
  httpsCallable,
  getCurrentUser = () => null,
  allowProduction = false
} = {}) {
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      async ask() { throw new Error("Hosted assistant is disabled until the owner configures it."); }
    });
  }

  if (!ALLOWED_ENDPOINTS.has(endpointName)) throw new Error("Unsupported hosted assistant endpoint.");
  if (endpointName === "canonAssistant" && allowProduction !== true) {
    throw new Error("Production callable access requires an explicit owner release configuration.");
  }
  if (!functions || typeof httpsCallable !== "function") {
    throw new Error("The Firebase Functions SDK adapter is not configured.");
  }

  const callable = httpsCallable(functions, endpointName, { limitedUseAppCheckTokens: true });
  if (typeof callable !== "function") throw new Error("Firebase returned an invalid callable adapter.");
  const maxQuestionLength = endpointName === "canonAssistantDev" ? 1200 : 2000;

  return Object.freeze({
    enabled: true,
    endpointName,
    async ask(rawQuestion, { cloudProcessingConsent = false } = {}) {
      if (!cloudProcessingConsent) throw new Error("Explicit consent is required before sending a question to the hosted assistant.");
      if (!getCurrentUser()) throw new Error("Sign in before using the hosted assistant.");
      if (typeof rawQuestion !== "string") throw new Error("Enter a text question.");
      const question = rawQuestion.trim();
      if (!question) throw new Error("Enter a question.");
      if (question.length > maxQuestionLength) throw new Error(`Question is longer than the ${maxQuestionLength}-character limit.`);

      let result;
      try {
        // Only the user-entered question crosses the boundary. No dog/profile/session context.
        result = await callable({ question });
      } catch {
        throw new Error("The hosted assistant request failed. Local profile data was not sent.");
      }
      return normalizeCanonAssistantResponse(result);
    }
  });
}
