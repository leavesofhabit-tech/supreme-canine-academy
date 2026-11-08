const ENDPOINTS = new Set(["academyAssistantDev", "academyAssistant"]);
const STATUSES = new Set([
  "answer", "not-found-in-academy", "safety-escalation", "access-pending", "assistant-disabled", "rate-limited",
]);
const SAFE_NO_ANSWER = Object.freeze({
  status: "not-found-in-academy",
  answer: "The hosted response did not include a verifiable Academy citation, so it was not shown.",
  grounding: "none",
  citations: [],
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCitation(value) {
  if (!isPlainObject(value)) return null;
  const { documentId, title, section, pageStart, pageEnd } = value;
  const hasNoPages = pageStart === null && pageEnd === null;
  if (typeof documentId !== "string" || !documentId.trim()
    || typeof title !== "string" || !title.trim()
    || typeof section !== "string" || !section.trim()
    || (!hasNoPages && (!Number.isInteger(pageStart) || pageStart < 1
      || !Number.isInteger(pageEnd) || pageEnd < pageStart))) return null;
  return Object.freeze({
    documentId: documentId.slice(0, 160),
    title: title.slice(0, 240),
    section: section.slice(0, 400),
    pageStart,
    pageEnd,
    ...(typeof value.excerpt === "string" && value.excerpt.trim() ? { excerpt: value.excerpt.slice(0, 1200) } : {}),
  });
}

export function normalizeAcademyAssistantResponse(result) {
  const data = isPlainObject(result?.data) ? result.data : result;
  if (!isPlainObject(data) || !STATUSES.has(data.status)) return SAFE_NO_ANSWER;
  const answer = typeof data.answer === "string" ? data.answer.trim().slice(0, 8000) : "";
  const grounding = ["strong", "limited", "none"].includes(data.grounding) ? data.grounding : "none";
  const citations = Array.isArray(data.citations) ? data.citations.slice(0, 5).map(normalizeCitation).filter(Boolean) : [];
  if (!answer) return SAFE_NO_ANSWER;
  if (data.status === "answer" && (grounding === "none" || citations.length === 0)) return SAFE_NO_ANSWER;
  return Object.freeze({ status: data.status, answer, grounding, citations: Object.freeze(citations) });
}

function buildCallable({ functions, httpsCallable, name }) {
  const call = httpsCallable(functions, name, { limitedUseAppCheckTokens: true });
  if (typeof call !== "function") throw new Error("Firebase returned an invalid Academy callable.");
  return call;
}

export function createAcademyAssistantClient({
  enabled = false,
  endpointName = "academyAssistantDev",
  functions,
  httpsCallable,
  getCurrentUser = () => null,
  allowProduction = false,
} = {}) {
  if (!enabled) return Object.freeze({ enabled: false, async ask() { throw new Error("Hosted Academy answers are disabled until the owner configures them."); } });
  if (!ENDPOINTS.has(endpointName)) throw new Error("Unsupported Academy assistant endpoint.");
  if (endpointName === "academyAssistant" && allowProduction !== true) throw new Error("Production Academy access requires explicit owner release configuration.");
  if (!functions || typeof httpsCallable !== "function") throw new Error("Firebase Functions SDK is not configured.");
  const call = buildCallable({ functions, httpsCallable, name: endpointName });
  return Object.freeze({
    enabled: true,
    endpointName,
    async ask(rawQuestion, { cloudProcessingConsent = false } = {}) {
      if (!cloudProcessingConsent) throw new Error("Choose hosted processing for this question before sending it.");
      if (!getCurrentUser()) throw new Error("Sign in before using the hosted Academy assistant.");
      if (typeof rawQuestion !== "string") throw new Error("Enter a text question.");
      const question = rawQuestion.trim();
      if (!question) throw new Error("Enter a question.");
      if (question.length > 1200) throw new Error("Question is longer than the 1,200-character limit.");
      try {
        // Profiles, session settings, prior turns, and chat history are not accepted here.
        return normalizeAcademyAssistantResponse(await call({ question }));
      } catch {
        throw new Error("The hosted Academy request failed. No dog profile or chat history was sent.");
      }
    },
  });
}

export function createAcademyAccountClient({
  enabled = false,
  functions,
  httpsCallable,
  getCurrentUser = () => null,
} = {}) {
  if (!enabled) return Object.freeze({ enabled: false, async syncAfterSignup() { return { status: "disabled", accessStatus: "pending" }; } });
  if (!functions || typeof httpsCallable !== "function") throw new Error("Firebase Functions SDK is not configured.");
  const sync = buildCallable({ functions, httpsCallable, name: "academyAccountSync" });
  const counts = buildCallable({ functions, httpsCallable, name: "academyAccountCounts" });
  return Object.freeze({
    enabled: true,
    async syncAfterSignup({ username = "" } = {}) {
      if (!getCurrentUser()) throw new Error("Sign in before registering Academy account metadata.");
      const normalized = String(username).trim().replace(/\s+/g, " ");
      if (normalized.length > 40) throw new Error("Username must be 40 characters or fewer.");
      try {
        // Email is taken from verified Firebase Auth context on the server; no password/profile is sent.
        return (await sync({ username: normalized })).data;
      } catch {
        throw new Error("The account was created, but Academy account setup is pending. No dog data was sent.");
      }
    },
    async getCounts() {
      if (!getCurrentUser()) throw new Error("Sign in before requesting Academy account counts.");
      try { return (await counts({})).data; }
      catch { throw new Error("Academy account counts are unavailable."); }
    },
  });
}
