export const ACADEMY_CORPUS_KEY = "supreme-canine-academy";
export const ACADEMY_DEV_COLLECTION = "academyTrainingChunksDev";
export const ACADEMY_PROD_COLLECTION = "academyTrainingChunksProd";

const MARKER_RULES = Object.freeze([
  { cue: "YES", meaning: "Releases the position and promises a treat." },
  { cue: "GOOD", meaning: "Maintains the position; reward comes later." },
  { cue: "NO", meaning: "Stops unwanted behavior." },
  { cue: "NOPE", meaning: "A distinct playful teaching retry or adjustment signal." },
  { cue: "OKAY", meaning: "A general release." },
]);
const POSITION_RULE = "A positional cue continues until a release or another command; a separate Stay cue is not required.";
const OWNER_CITATION = Object.freeze({
  documentId: "SCA-MARKERS-001",
  title: "Owner-confirmed cue contract",
  section: "Marker meanings and positional duration",
  pageStart: null,
  pageEnd: null,
  excerpt: `${MARKER_RULES.map(({ cue, meaning }) => `${cue}: ${meaning}`).join("\n")}\n${POSITION_RULE}\nDo not infer force or correction intensity.`,
});

const STOP_WORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "our", "the", "this", "to", "we", "what", "when", "with", "you", "your",
]);
const URGENT_TERMS = [
  "collapse", "cannot breathe", "can't breathe", "difficulty breathing", "seizure", "repeated vomiting", "dry retch", "swollen abdomen", "bloat", "xylitol", "poison", "toxin", "overdose",
];
const HEALTH_TERMS = [
  "symptom", "vomit", "diarrhea", "not eating", "won't eat", "lethargic", "limping", "pain", "injury", "medication", "dose", "dosage", "fever", "sick", "ill",
];

export class AcademyBackendError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AcademyBackendError";
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireAuth(request) {
  if (!request?.auth?.uid) throw new AcademyBackendError("unauthenticated", "Sign in to use the Academy service.");
  if (!request?.app?.appId) throw new AcademyBackendError("failed-precondition", "This app is not verified for the Academy service.");
}

function normalizeUsername(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new AcademyBackendError("invalid-argument", "Username must be text.");
  const username = value.trim().replace(/\s+/g, " ");
  if (username.length > 40) throw new AcademyBackendError("invalid-argument", "Username must be 40 characters or fewer.");
  if (/[\u0000-\u001f\u007f]/.test(username)) throw new AcademyBackendError("invalid-argument", "Username contains unsupported characters.");
  return username;
}

function cleanApprovedRecord(record) {
  if (!isPlainObject(record)) return null;
  if (
    record.corpusKey !== ACADEMY_CORPUS_KEY
    || record.status !== "approved"
    || record.productionEligible !== true
    || record.rightsStatus !== "cleared_for_hosted_use"
    || record.restricted !== false
  ) return null;

  const citation = record.citation;
  if (!isPlainObject(citation)
    || typeof citation.documentId !== "string" || !citation.documentId.trim()
    || typeof citation.title !== "string" || !citation.title.trim()
    || typeof citation.section !== "string" || !citation.section.trim()
    || !Number.isInteger(citation.pageStart) || citation.pageStart < 1
    || !Number.isInteger(citation.pageEnd) || citation.pageEnd < citation.pageStart) return null;

  const body = typeof record.body === "string" ? record.body.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!body && !summary) return null;
  return {
    id: String(record.id ?? citation.documentId).slice(0, 160),
    title: record.title.trim().slice(0, 240),
    summary: summary.slice(0, 1800),
    body: body.slice(0, 16000),
    topics: Array.isArray(record.topics) ? record.topics.filter((item) => typeof item === "string").slice(0, 20) : [],
    aliases: Array.isArray(record.aliases) ? record.aliases.filter((item) => typeof item === "string").slice(0, 20) : [],
    citation: Object.freeze({
      documentId: citation.documentId.slice(0, 160),
      title: citation.title.slice(0, 240),
      section: citation.section.slice(0, 400),
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
      ...(typeof citation.excerpt === "string" ? { excerpt: citation.excerpt.slice(0, 1200) } : {}),
    }),
  };
}

function validQuestionRequest(data) {
  if (!isPlainObject(data)) throw new AcademyBackendError("invalid-argument", "Send one question as text.");
  const keys = Object.keys(data);
  if (keys.some((key) => key !== "question")) {
    throw new AcademyBackendError("invalid-argument", "Only the question is accepted; dog profiles and conversation history stay on this device.");
  }
  if (typeof data.question !== "string") throw new AcademyBackendError("invalid-argument", "Question must be text.");
  const question = data.question.trim();
  if (!question) throw new AcademyBackendError("invalid-argument", "Enter a question.");
  if (question.length > 1200) throw new AcademyBackendError("invalid-argument", "Question is longer than the 1,200-character limit.");
  if (/[\u0000]/.test(question)) throw new AcademyBackendError("invalid-argument", "Question contains unsupported characters.");
  return question;
}

function noAnswer(status, answer) {
  return Object.freeze({ status, answer, grounding: "none", citations: [] });
}

function markerAnswer(question) {
  const normalized = question.toLowerCase();
  const cueMatches = MARKER_RULES.filter(({ cue }) => new RegExp(`\\b${cue.toLowerCase()}\\b`, "i").test(normalized));
  const intent = /\b(marker|markers|meaning|means|cue|release|positional|hold|holding|stay|retry|reward)\b/i.test(normalized);
  if (!intent || cueMatches.length === 0 && !/\b(positional|stay|hold|holding)\b/i.test(normalized)) return null;
  const selected = cueMatches.length === 1 ? cueMatches : MARKER_RULES;
  const lines = selected.map(({ cue, meaning }) => `${cue}: ${meaning}`);
  if (/\b(positional|stay|hold|holding)\b/i.test(normalized)) lines.push(`Positional cues: ${POSITION_RULE}`);
  return Object.freeze({
    status: "answer",
    answer: lines.join("\n"),
    grounding: "strong",
    citations: [OWNER_CITATION],
  });
}

function safetyAnswer(question) {
  const normalized = question.toLowerCase();
  if (URGENT_TERMS.some((term) => normalized.includes(term))) {
    return noAnswer("safety-escalation", "This may need urgent veterinary care. Contact an emergency veterinary clinic now; do not wait for a training response or try home treatment unless a veterinarian directs you.");
  }
  if (HEALTH_TERMS.some((term) => normalized.includes(term))) {
    return noAnswer("safety-escalation", "I can't assess symptoms or medication questions. Contact your veterinarian and describe the exact signs and when they began. Seek emergency veterinary care for severe, sudden, or worsening signs.");
  }
  return null;
}

function termsFor(query) {
  return [...new Set((query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((term) => term.length > 1 && !STOP_WORDS.has(term)))];
}

function findSupportedRecords(question, records) {
  const terms = termsFor(question);
  if (terms.length === 0 || records.length === 0) return [];
  const queryPhrase = question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return records.map((record) => {
    const title = record.title.toLowerCase();
    const summary = record.summary.toLowerCase();
    const body = record.body.toLowerCase();
    const topics = record.topics.join(" ").toLowerCase();
    const matched = terms.filter((term) => `${title} ${summary} ${body} ${topics}`.includes(term));
    const coverage = matched.length / terms.length;
    const exactTitlePhrase = title.includes(queryPhrase) || queryPhrase.includes(title);
    const titleMatches = terms.filter((term) => title.includes(term)).length;
    const score = titleMatches * 3 + terms.filter((term) => summary.includes(term)).length * 2 + terms.filter((term) => topics.includes(term)).length * 2 + terms.filter((term) => body.includes(term)).length;
    const enoughEvidence = exactTitlePhrase || (matched.length >= 2 && coverage >= 0.4) || (terms.length <= 2 && titleMatches >= 1 && coverage === 1);
    return { record, matched, coverage, score, enoughEvidence };
  }).filter((hit) => hit.enoughEvidence && hit.score > 0)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.record.id.localeCompare(b.record.id))
    .slice(0, 3);
}

export function createAcademyBackend({
  accounts,
  corpus,
  enabled = false,
  collectionName = ACADEMY_PROD_COLLECTION,
  maxCorpusRecords = 100,
} = {}) {
  if (!accounts || typeof accounts.get !== "function" || typeof accounts.createFromSignup !== "function" || typeof accounts.counts !== "function") {
    throw new Error("Academy account repository is required.");
  }
  if (!corpus || typeof corpus.listApproved !== "function") throw new Error("Academy corpus repository is required.");
  if (![ACADEMY_DEV_COLLECTION, ACADEMY_PROD_COLLECTION].includes(collectionName)) throw new Error("Unsupported Academy corpus collection.");

  async function accountSync(request) {
    requireAuth(request);
    const data = request.data ?? {};
    if (!isPlainObject(data) || Object.keys(data).some((key) => key !== "username")) {
      throw new AcademyBackendError("invalid-argument", "Only a username can be registered with the Academy account summary.");
    }
    if (!enabled) return Object.freeze({ status: "disabled", accessStatus: "pending" });
    const email = typeof request.auth.token?.email === "string" ? request.auth.token.email.trim().toLowerCase() : "";
    if (!email) throw new AcademyBackendError("failed-precondition", "An email address is required for the Academy account.");
    const username = normalizeUsername(data.username ?? request.auth.token?.name ?? "");
    const summary = await accounts.createFromSignup({ uid: request.auth.uid, email, username });
    return Object.freeze({ status: "registered", accessStatus: summary.accessStatus });
  }

  async function accountCounts(request) {
    requireAuth(request);
    if (request.auth.token?.scaAdmin !== true) throw new AcademyBackendError("permission-denied", "Academy owner access is required.");
    if (!enabled) return Object.freeze({ status: "disabled", registeredAccounts: 0, activeAccess: 0 });
    const totals = await accounts.counts();
    return Object.freeze({ status: "ok", registeredAccounts: totals.registeredAccounts, activeAccess: totals.activeAccess });
  }

  async function assistant(request) {
    requireAuth(request);
    const question = validQuestionRequest(request.data);
    if (!enabled) return noAnswer("assistant-disabled", "Hosted Academy answers are disabled until owner-approved content and backend settings are ready.");

    const account = await accounts.get(request.auth.uid);
    if (!account || account.accessStatus !== "active") {
      return noAnswer("access-pending", "This Academy account is awaiting owner approval for beta access.");
    }
    const safety = safetyAnswer(question);
    if (safety) return safety;
    const marker = markerAnswer(question);
    if (marker) return marker;

    const rawRecords = await corpus.listApproved({ collectionName, corpusKey: ACADEMY_CORPUS_KEY, limit: maxCorpusRecords });
    const records = (Array.isArray(rawRecords) ? rawRecords : []).map(cleanApprovedRecord).filter(Boolean);
    const matches = findSupportedRecords(question, records);
    if (!matches.length) {
      return noAnswer("not-found-in-academy", "No sufficiently supported passage was found in the Academy hosted library. Try a narrower question or consult a qualified professional for individualized guidance.");
    }
    const best = matches[0].record;
    const passage = best.summary || best.body.slice(0, 900);
    return Object.freeze({
      status: "answer",
      answer: passage,
      grounding: "limited",
      citations: Object.freeze(matches.map(({ record }) => record.citation)),
    });
  }

  return Object.freeze({ accountSync, accountCounts, assistant, enabled, collectionName });
}

export function createFirestoreAcademyRepositories({ db, fieldValue }) {
  if (!db || typeof db.collection !== "function" || !fieldValue || typeof fieldValue.serverTimestamp !== "function") {
    throw new Error("Firestore database and FieldValue adapter are required.");
  }
  const accountsCollection = db.collection("academyAccounts");

  const accounts = Object.freeze({
    async createFromSignup({ uid, email, username }) {
      const reference = accountsCollection.doc(uid);
      let accountData;
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (snapshot.exists) {
          accountData = snapshot.data();
          return;
        }
        accountData = { email, username, accessStatus: "pending", schemaVersion: 1, createdAt: fieldValue.serverTimestamp() };
        transaction.create(reference, accountData);
      });
      return { accessStatus: accountData?.accessStatus ?? "pending" };
    },
    async get(uid) {
      const snapshot = await accountsCollection.doc(uid).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async counts() {
      const [registered, active] = await Promise.all([
        accountsCollection.count().get(),
        accountsCollection.where("accessStatus", "==", "active").count().get(),
      ]);
      return { registeredAccounts: registered.data().count, activeAccess: active.data().count };
    },
  });

  function corpusRepository() {
    return Object.freeze({
      async listApproved({ collectionName, corpusKey, limit }) {
        const snapshot = await db.collection(collectionName)
          .where("corpusKey", "==", corpusKey)
          .where("status", "==", "approved")
          .where("productionEligible", "==", true)
          .where("rightsStatus", "==", "cleared_for_hosted_use")
          .limit(limit)
          .get();
        return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
      },
    });
  }
  return Object.freeze({ accounts, corpus: corpusRepository() });
}
