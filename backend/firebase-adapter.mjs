import { AcademyBackendError } from "./academy-core.mjs";

const COMMON_CALL_OPTIONS = Object.freeze({
  region: "us-central1",
  enforceAppCheck: true,
  maxInstances: 2,
  minInstances: 0,
});

function wrapCall(handler, HttpsError) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof AcademyBackendError) {
        throw new HttpsError(error.code, error.message);
      }
      throw new HttpsError("internal", "The Academy request could not be completed.");
    }
  };
}

/** Create Firebase callable exports without binding the pure backend to SDK globals. */
export function createFirebaseAcademyFunctions({ onCall, HttpsError, accountBackend, devBackend, prodBackend } = {}) {
  if (typeof onCall !== "function" || typeof HttpsError !== "function") {
    throw new Error("Firebase callable adapter functions are required.");
  }
  const requiredHandlers = [
    ["accountBackend", accountBackend, "accountSync"],
    ["accountBackend", accountBackend, "accountCounts"],
    ["devBackend", devBackend, "assistant"],
    ["prodBackend", prodBackend, "assistant"],
  ];
  for (const [name, backend, method] of requiredHandlers) {
    if (!backend || typeof backend[method] !== "function") throw new Error(`${name}.${method} handler is required.`);
  }

  return Object.freeze({
    academyAccountSync: onCall(COMMON_CALL_OPTIONS, wrapCall(accountBackend.accountSync, HttpsError)),
    academyAccountCounts: onCall(COMMON_CALL_OPTIONS, wrapCall(accountBackend.accountCounts, HttpsError)),
    academyAssistantDev: onCall(COMMON_CALL_OPTIONS, wrapCall(devBackend.assistant, HttpsError)),
    academyAssistant: onCall(COMMON_CALL_OPTIONS, wrapCall(prodBackend.assistant, HttpsError)),
  });
}
