import test from "node:test";
import assert from "node:assert/strict";
import {
  ACADEMY_CORPUS_KEY,
  ACADEMY_DEV_COLLECTION,
  ACADEMY_PROD_COLLECTION,
  AcademyBackendError,
  createAcademyBackend,
  createFirestoreAcademyRepositories,
} from "../academy-core.mjs";

const auth = { uid: "uid-test-1", token: { email: "mike@example.invalid", name: "Mike" } };
const app = { appId: "sca-test-app" };
const approvedChunk = {
  id: "SCA-TEST-STATION-01",
  corpusKey: ACADEMY_CORPUS_KEY,
  status: "approved",
  productionEligible: true,
  rightsStatus: "cleared_for_hosted_use",
  restricted: false,
  title: "Mat station settle",
  summary: "Practice a comfortable settle on a mat with brief, voluntary repetitions.",
  body: "Start with the mat still on the floor. Reward the dog for choosing to approach and leave space to disengage.",
  topics: ["mat", "station", "settle"],
  citation: {
    documentId: "SCA-TEST-STATION-01",
    title: "Mat station settle",
    section: "Beginning the skill",
    pageStart: 2,
    pageEnd: 3,
    excerpt: "Reward the dog for choosing to approach and leave space to disengage.",
  },
};

function repositories({ accountStatus = "active", records = [approvedChunk] } = {}) {
  const calls = { reads: 0, signup: [], counts: 0 };
  const accounts = {
    async get(uid) { calls.reads += 1; return uid === auth.uid && accountStatus ? { accessStatus: accountStatus } : null; },
    async createFromSignup(input) { calls.signup.push(input); return { accessStatus: "pending" }; },
    async counts() { calls.counts += 1; return { registeredAccounts: 7, activeAccess: 2 }; },
  };
  const corpus = {
    async listApproved(options) { calls.corpusOptions = options; calls.corpusReads = (calls.corpusReads ?? 0) + 1; return records; },
  };
  return { accounts, corpus, calls };
}

test("assistant is disabled by default and does not read corpus", async () => {
  const deps = repositories();
  const backend = createAcademyBackend({ ...deps });
  const answer = await backend.assistant({ data: { question: "mat settle" }, auth, app });
  assert.equal(answer.status, "assistant-disabled");
  assert.equal(deps.calls.corpusReads, undefined);
});

test("every callable requires authenticated, App Check-attested context", async () => {
  const backend = createAcademyBackend({ ...repositories(), enabled: true });
  await assert.rejects(backend.assistant({ data: { question: "mat settle" }, app }), (error) => error.code === "unauthenticated");
  await assert.rejects(backend.assistant({ data: { question: "mat settle" }, auth }), (error) => error.code === "failed-precondition");
  await assert.rejects(backend.accountSync({ data: {}, auth }), (error) => error.code === "failed-precondition");
});

test("assistant accepts only question text and rejects dog/profile/history payloads", async () => {
  const deps = repositories();
  const backend = createAcademyBackend({ ...deps, enabled: true });
  await assert.rejects(backend.assistant({ data: { question: "mat settle", dog: { name: "Nova" } }, auth, app }), /Only the question is accepted/);
  await assert.rejects(backend.assistant({ data: { question: "mat settle", previousTurns: [] }, auth, app }), /Only the question is accepted/);
  assert.equal(deps.calls.corpusReads, undefined);
});

test("pending beta access blocks retrieval before corpus reads", async () => {
  const deps = repositories({ accountStatus: "pending" });
  const backend = createAcademyBackend({ ...deps, enabled: true });
  const answer = await backend.assistant({ data: { question: "mat settle" }, auth, app });
  assert.equal(answer.status, "access-pending");
  assert.equal(deps.calls.corpusReads, undefined);
});

test("retrieval reads only the dedicated Academy production collection and returns exact citations", async () => {
  const draftsAndContamination = [
    approvedChunk,
    { ...approvedChunk, id: "DRAFT-1", status: "review_required", citation: { ...approvedChunk.citation, documentId: "DRAFT-1" } },
    { ...approvedChunk, id: "RIGHTS-1", rightsStatus: "unknown", citation: { ...approvedChunk.citation, documentId: "RIGHTS-1" } },
    { ...approvedChunk, id: "RESTRICTED-1", restricted: true, citation: { ...approvedChunk.citation, documentId: "RESTRICTED-1" } },
    { ...approvedChunk, id: "FOREIGN-1", corpusKey: "other-corpus", citation: { ...approvedChunk.citation, documentId: "FOREIGN-1" } },
    { ...approvedChunk, id: "NO-CITE-1", citation: null },
  ];
  const deps = repositories({ records: draftsAndContamination });
  const backend = createAcademyBackend({ ...deps, enabled: true });
  const answer = await backend.assistant({ data: { question: "How to practice a mat station settle?" }, auth, app });
  assert.equal(answer.status, "answer");
  assert.equal(answer.grounding, "limited");
  assert.deepEqual(answer.citations.map((citation) => citation.documentId), ["SCA-TEST-STATION-01"]);
  assert.match(answer.answer, /comfortable settle/);
  assert.equal(deps.calls.corpusOptions.collectionName, ACADEMY_PROD_COLLECTION);
  assert.equal(deps.calls.corpusOptions.corpusKey, ACADEMY_CORPUS_KEY);
});

test("unrelated questions abstain instead of returning weak lexical matches", async () => {
  const backend = createAcademyBackend({ ...repositories(), enabled: true });
  const answer = await backend.assistant({ data: { question: "What are today's mortgage rates?" }, auth, app });
  assert.equal(answer.status, "not-found-in-academy");
  assert.deepEqual(answer.citations, []);
});

test("health and emergency terms route to conservative referral without corpus search", async () => {
  for (const [question, expected] of [["My dog may have eaten xylitol", /emergency veterinary clinic now/], ["My dog is limping", /Contact your veterinarian/]]) {
    const deps = repositories();
    const backend = createAcademyBackend({ ...deps, enabled: true });
    const answer = await backend.assistant({ data: { question }, auth, app });
    assert.equal(answer.status, "safety-escalation");
    assert.match(answer.answer, expected);
    assert.deepEqual(answer.citations, []);
    assert.equal(deps.calls.corpusReads, undefined);
  }
});

test("owner marker contract is deterministic and independent of unapproved training records", async () => {
  const deps = repositories({ records: [] });
  const backend = createAcademyBackend({ ...deps, enabled: true });
  const answer = await backend.assistant({ data: { question: "What do YES and GOOD mean, and does a position need Stay?" }, auth, app });
  assert.equal(answer.status, "answer");
  assert.match(answer.answer, /YES: Releases the position and promises a treat/);
  assert.match(answer.answer, /GOOD: Maintains the position; reward comes later/);
  assert.match(answer.answer, /NO: Stops unwanted behavior/);
  assert.match(answer.answer, /NOPE: A distinct playful teaching retry or adjustment signal/);
  assert.match(answer.answer, /OKAY: A general release/);
  assert.match(answer.answer, /a separate Stay cue is not required/);
  assert.deepEqual(answer.citations.map((citation) => citation.documentId), ["SCA-MARKERS-001"]);
  assert.equal(answer.citations[0].pageStart, null, "the owner reference is not presented as a paginated source");
  assert.match(answer.citations[0].excerpt, /NOPE: A distinct playful teaching retry/);
  assert.equal(deps.calls.corpusReads, undefined);
});

test("account signup summary records only server-derived email and caller username, defaults to pending", async () => {
  const deps = repositories();
  const backend = createAcademyBackend({ ...deps, enabled: true });
  const result = await backend.accountSync({ data: { username: "  Mike   S. " }, auth, app });
  assert.deepEqual(result, { status: "registered", accessStatus: "pending" });
  assert.deepEqual(deps.calls.signup, [{ uid: auth.uid, email: "mike@example.invalid", username: "Mike S." }]);
  await assert.rejects(backend.accountSync({ data: { username: "Mike", accessStatus: "active" }, auth, app }), /Only a username/);
});

test("owner account counts require the custom admin claim and contain no activity counters", async () => {
  const deps = repositories();
  const backend = createAcademyBackend({ ...deps, enabled: true });
  await assert.rejects(backend.accountCounts({ data: {}, auth, app }), (error) => error.code === "permission-denied");
  const result = await backend.accountCounts({ data: {}, auth: { ...auth, token: { ...auth.token, scaAdmin: true } }, app });
  assert.deepEqual(result, { status: "ok", registeredAccounts: 7, activeAccess: 2 });
  assert.equal("questionsAsked" in result, false);
  assert.equal("lastActiveAt" in result, false);
  assert.equal(deps.calls.counts, 1);
});

test("Firestore account repository is idempotent and never upgrades access from client input", async () => {
  const docs = new Map();
  const accountCollection = {
    doc(uid) {
      return {
        path: `academyAccounts/${uid}`,
        async get() { const data = docs.get(uid); return { exists: Boolean(data), data: () => data }; },
      };
    },
    count() { return { get: async () => ({ data: () => ({ count: docs.size }) }) }; },
    where(field, operator, value) {
      assert.deepEqual([field, operator, value], ["accessStatus", "==", "active"]);
      return { count: () => ({ get: async () => ({ data: () => ({ count: [...docs.values()].filter((doc) => doc.accessStatus === "active").length }) }) }) };
    },
  };
  const db = {
    collection(name) { assert.equal(name, "academyAccounts"); return accountCollection; },
    async runTransaction(work) {
      const transaction = {
        async get(reference) { const uid = reference.path.split("/")[1]; const data = docs.get(uid); return { exists: Boolean(data), data: () => data }; },
        create(reference, value) { const uid = reference.path.split("/")[1]; if (docs.has(uid)) throw new Error("already-exists"); docs.set(uid, value); },
      };
      return work(transaction);
    },
  };
  const repositories = createFirestoreAcademyRepositories({ db, fieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } });
  const first = await repositories.accounts.createFromSignup({ uid: "uid-test-1", email: "mike@example.invalid", username: "Mike" });
  const retry = await repositories.accounts.createFromSignup({ uid: "uid-test-1", email: "other@example.invalid", username: "Changed" });
  assert.deepEqual(first, { accessStatus: "pending" });
  assert.deepEqual(retry, { accessStatus: "pending" });
  assert.deepEqual(docs.get("uid-test-1"), { email: "mike@example.invalid", username: "Mike", accessStatus: "pending", schemaVersion: 1, createdAt: "SERVER_TIMESTAMP" });
  docs.get("uid-test-1").accessStatus = "active";
  assert.deepEqual(await repositories.accounts.counts(), { registeredAccounts: 1, activeAccess: 1 });
});

test("Firestore corpus repository pins collection filters to Academy-approved records", async () => {
  const predicates = [];
  const expectedDoc = { id: "approved-1", data: () => approvedChunk };
  const query = {
    where(field, operator, value) { predicates.push([field, operator, value]); return query; },
    limit(value) { assert.equal(value, 25); return query; },
    async get() { return { docs: [expectedDoc] }; },
  };
  const db = { collection(name) {
    if (name === "academyAccounts") return { doc() { return {}; } };
    assert.equal(name, ACADEMY_DEV_COLLECTION);
    return query;
  } };
  const repos = createFirestoreAcademyRepositories({ db, fieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } });
  const result = await repos.corpus.listApproved({ collectionName: ACADEMY_DEV_COLLECTION, corpusKey: ACADEMY_CORPUS_KEY, limit: 25 });
  assert.deepEqual(predicates, [
    ["corpusKey", "==", ACADEMY_CORPUS_KEY],
    ["status", "==", "approved"],
    ["productionEligible", "==", true],
    ["rightsStatus", "==", "cleared_for_hosted_use"],
  ]);
  assert.equal(result[0].id, "approved-1");
});
