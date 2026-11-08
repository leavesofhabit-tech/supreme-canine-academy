import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseAcademyFunctions } from "../firebase-adapter.mjs";

class MockHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

test("Firebase exports are Academy-only and enforce App Check with bounded instances", () => {
  const definitions = [];
  const onCall = (options, handler) => { const item = { options, handler }; definitions.push(item); return item; };
  const handler = async () => ({ status: "ok" });
  const exports = createFirebaseAcademyFunctions({
    onCall,
    HttpsError: MockHttpsError,
    accountBackend: { accountSync: handler, accountCounts: handler },
    devBackend: { assistant: handler },
    prodBackend: { assistant: handler },
  });
  assert.deepEqual(Object.keys(exports), ["academyAccountSync", "academyAccountCounts", "academyAssistantDev", "academyAssistant"]);
  assert.equal(definitions.length, 4);
  for (const definition of definitions) {
    assert.equal(definition.options.enforceAppCheck, true);
    assert.equal(definition.options.maxInstances, 2);
    assert.equal(definition.options.minInstances, 0);
    assert.equal(definition.options.region, "us-central1");
  }
});

test("Firebase adapter refuses incomplete account backend handlers", () => {
  assert.throws(() => createFirebaseAcademyFunctions({
    onCall: (_options, handler) => handler,
    HttpsError: MockHttpsError,
    accountBackend: { accountSync: async () => ({}) },
    devBackend: { assistant: async () => ({}) },
    prodBackend: { assistant: async () => ({}) },
  }), /accountBackend\.accountCounts/);
});

test("known backend errors preserve safe codes while unexpected errors are sanitized", async () => {
  const onCall = (options, handler) => ({ options, handler });
  const { AcademyBackendError } = await import("../academy-core.mjs");
  const accountBackend = {
    accountSync: async () => { throw new AcademyBackendError("unauthenticated", "Sign in first."); },
    accountCounts: async () => { throw new Error("secret-account-detail"); },
  };
  const funcs = createFirebaseAcademyFunctions({ onCall, HttpsError: MockHttpsError, accountBackend, devBackend: { assistant: async () => ({}) }, prodBackend: { assistant: async () => ({}) } });
  await assert.rejects(funcs.academyAccountSync.handler({}), (error) => error instanceof MockHttpsError && error.code === "unauthenticated" && error.message === "Sign in first.");
  await assert.rejects(funcs.academyAccountCounts.handler({}), (error) => error instanceof MockHttpsError && error.code === "internal" && !error.message.includes("secret-account-detail"));
});
