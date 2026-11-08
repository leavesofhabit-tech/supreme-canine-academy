import test from "node:test";
import assert from "node:assert/strict";
import {
  createAcademyAccountClient,
  createAcademyAssistantClient,
  normalizeAcademyAssistantResponse,
} from "../src/academy-assistant-client.js";

const citedAnswer = {
  data: {
    status: "answer",
    answer: "A short, supported starting point.",
    grounding: "strong",
    citations: [{ documentId: "SCA-TRAIN-1", title: "Training basics", section: "Begin here", pageStart: 2, pageEnd: 3, excerpt: "Keep the first step brief." }],
  },
};

test("Academy hosted retrieval is disabled by default", async () => {
  let initialized = false;
  const client = createAcademyAssistantClient({ httpsCallable: () => { initialized = true; } });
  assert.equal(client.enabled, false);
  await assert.rejects(client.ask("Question?"), /disabled/i);
  assert.equal(initialized, false);
});

test("Academy hosted requests require sign-in and per-question consent and send only question text", async () => {
  let currentUser = null;
  let payload;
  let options;
  let calls = 0;
  const factory = (_functions, name, callOptions) => {
    assert.equal(name, "academyAssistantDev");
    options = callOptions;
    return async (data) => { calls += 1; payload = data; return citedAnswer; };
  };
  const client = createAcademyAssistantClient({ enabled: true, functions: {}, httpsCallable: factory, getCurrentUser: () => currentUser });
  await assert.rejects(client.ask("Question?", { cloudProcessingConsent: true }), /sign in/i);
  currentUser = { uid: "user-1" };
  await assert.rejects(client.ask("Question?"), /choose hosted processing/i);
  assert.equal(calls, 0);

  const result = await client.ask("  Question?  ", { cloudProcessingConsent: true });
  assert.equal(calls, 1);
  assert.deepEqual(options, { limitedUseAppCheckTokens: true });
  assert.deepEqual(payload, { question: "Question?" });
  assert.equal(result.citations[0].documentId, "SCA-TRAIN-1");
  assert.equal("dogProfile" in payload, false);
  assert.equal("conversationHistory" in payload, false);
});

test("Academy responses with absent or invalid citations fail closed", () => {
  const uncited = normalizeAcademyAssistantResponse({ data: { status: "answer", answer: "Unsupported", grounding: "strong", citations: [] } });
  assert.equal(uncited.status, "not-found-in-academy");
  assert.deepEqual(uncited.citations, []);
  const malformed = normalizeAcademyAssistantResponse({ data: { status: "answer", answer: "Unsupported", grounding: "strong", citations: [{ documentId: "doc", title: "title", section: "section", pageStart: 0, pageEnd: 1 }] } });
  assert.equal(malformed.status, "not-found-in-academy");
  const noEvidence = normalizeAcademyAssistantResponse({ data: { status: "not-found-in-academy", answer: "No supporting passage.", grounding: "none", citations: [] } });
  assert.equal(noEvidence.status, "not-found-in-academy");
  const ownerReference = normalizeAcademyAssistantResponse({ data: { status: "answer", answer: "YES releases.", grounding: "strong", citations: [{ documentId: "SCA-MARKERS-001", title: "Owner-confirmed cue contract", section: "Marker meanings", pageStart: null, pageEnd: null, excerpt: "YES releases." }] } });
  assert.equal(ownerReference.citations[0].pageStart, null);
});

test("Academy production endpoint requires a separate explicit owner release flag", () => {
  assert.throws(() => createAcademyAssistantClient({ enabled: true, endpointName: "canonAssistant", functions: {}, httpsCallable: () => () => ({}) }), /unsupported/i);
  assert.throws(() => createAcademyAssistantClient({ enabled: true, endpointName: "academyAssistant", functions: {}, httpsCallable: () => () => ({}) }), /explicit owner release/i);
  assert.doesNotThrow(() => createAcademyAssistantClient({ enabled: true, endpointName: "academyAssistant", allowProduction: true, functions: {}, httpsCallable: () => async () => citedAnswer }));
});

test("Academy account sync sends only username and does not expose account totals to signed-out clients", async () => {
  let currentUser = null;
  const calls = [];
  const factory = (_functions, name) => async (payload) => {
    calls.push([name, payload]);
    return { data: name === "academyAccountSync" ? { status: "registered", accessStatus: "pending" } : { status: "ok", registeredAccounts: 2, activeAccess: 1 } };
  };
  const client = createAcademyAccountClient({ enabled: true, functions: {}, httpsCallable: factory, getCurrentUser: () => currentUser });
  await assert.rejects(client.syncAfterSignup({ username: "Mike" }), /sign in/i);
  await assert.rejects(client.getCounts(), /sign in/i);
  currentUser = { uid: "user-1", email: "must-not-be-sent@example.invalid" };
  const registered = await client.syncAfterSignup({ username: "  Mike   A " });
  assert.deepEqual(registered, { status: "registered", accessStatus: "pending" });
  assert.deepEqual(calls, [["academyAccountSync", { username: "Mike A" }]]);
  assert.equal(JSON.stringify(calls).includes("must-not-be-sent"), false);
});
