import test from "node:test";
import assert from "node:assert/strict";
import { createCanonAssistantClient, normalizeCanonAssistantResponse } from "../src/canon-assistant-client.js";

const validResponse = {
  data: {
    status: "answer",
    answer: "Use the cited steps and stop if the dog is uncomfortable.",
    grounding: "strong",
    requestId: "request-123",
    citations: [{ documentId: "approved-doc-1", title: "Training basics", section: "Short sessions", pageStart: 2, pageEnd: 3, excerpt: "Use brief, comfortable sessions." }],
    usage: { estimatedCostUsd: 0.01 },
    metrics: { latencyMs: 123 }
  }
};

test("hosted assistant is disabled by default and makes no SDK call", async () => {
  let initialized = false;
  const client = createCanonAssistantClient({ httpsCallable: () => { initialized = true; } });
  assert.equal(client.enabled, false);
  await assert.rejects(client.ask("How do I begin?"), /disabled/i);
  assert.equal(initialized, false);
});

test("only approved callable names are allowed and production requires an explicit release flag", () => {
  assert.throws(() => createCanonAssistantClient({ enabled: true, endpointName: "otherEndpoint" }), /unsupported/i);
  assert.throws(() => createCanonAssistantClient({ enabled: true, endpointName: "canonAssistant", functions: {}, httpsCallable: () => () => ({}) }), /explicit owner release/i);
});

test("dev callable requires sign-in and explicit per-question cloud consent", async () => {
  let payload;
  let options;
  let calls = 0;
  const callableFactory = (_functions, name, callOptions) => {
    assert.equal(name, "canonAssistantDev");
    options = callOptions;
    return async (value) => { calls += 1; payload = value; return validResponse; };
  };
  const client = createCanonAssistantClient({ enabled: true, endpointName: "canonAssistantDev", functions: {}, httpsCallable: callableFactory });
  await assert.rejects(client.ask("How do I begin?", { cloudProcessingConsent: true }), /sign in/i);
  assert.equal(calls, 0);

  const signedIn = createCanonAssistantClient({
    enabled: true,
    endpointName: "canonAssistantDev",
    functions: {},
    getCurrentUser: () => ({ uid: "mock-user" }),
    httpsCallable: callableFactory
  });
  await assert.rejects(signedIn.ask("How do I begin?"), /explicit consent/i);
  assert.equal(calls, 0);

  const result = await signedIn.ask("  How do I begin?  ", { cloudProcessingConsent: true });
  assert.deepEqual(options, { limitedUseAppCheckTokens: true });
  assert.deepEqual(payload, { question: "How do I begin?" });
  assert.equal(result.status, "answer");
  assert.equal(result.citations[0].documentId, "approved-doc-1");
  assert.equal("usage" in result, false);
  assert.equal("metrics" in result, false);
});

test("response normalization rejects uncited or malformed answers", () => {
  const uncited = normalizeCanonAssistantResponse({ data: { status: "answer", answer: "unsupported", grounding: "strong", citations: [] } });
  assert.equal(uncited.status, "not-found-in-canon");
  assert.deepEqual(uncited.citations, []);

  const malformed = normalizeCanonAssistantResponse({ data: { status: "answer", answer: "unsupported", grounding: "strong", citations: [{ documentId: "doc", title: "Title", section: "Section", pageStart: 0, pageEnd: 2 }] } });
  assert.equal(malformed.status, "not-found-in-canon");

  const notFound = normalizeCanonAssistantResponse({ data: { status: "not-found-in-canon", answer: "No supporting source was found.", grounding: "none", citations: [] } });
  assert.equal(notFound.status, "not-found-in-canon");
});

test("callable errors are sanitized and dog/profile fields cannot enter the request", async () => {
  let payload;
  const client = createCanonAssistantClient({
    enabled: true,
    endpointName: "canonAssistantDev",
    functions: {},
    getCurrentUser: () => ({ uid: "mock-user" }),
    httpsCallable: () => async (value) => { payload = value; throw new Error("private backend detail"); }
  });
  await assert.rejects(client.ask("Recall?", { cloudProcessingConsent: true }), /profile data was not sent/i);
  assert.deepEqual(payload, { question: "Recall?" });
  assert.equal(JSON.stringify(payload).includes("dog"), false);
});
