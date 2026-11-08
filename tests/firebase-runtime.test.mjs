import test from "node:test";
import assert from "node:assert/strict";
import { createFirebaseRuntime } from "../src/firebase-runtime.js";

test("local-review configuration does not initialize Firebase clients", async () => {
  const runtime = await createFirebaseRuntime({
    mode: "local-review",
    firebase: { apiKey: "", authDomain: "", projectId: "" },
    accountMetadataEnabled: true,
    hostedAssistant: { enabled: true },
  });
  assert.equal(runtime, null);
});

test("hosted callable configuration fails closed before Firebase initialization without App Check", async () => {
  await assert.rejects(createFirebaseRuntime({
    mode: "authenticated",
    firebase: { apiKey: "public-web-key", authDomain: "example.firebaseapp.com", projectId: "example-project" },
    hostedAssistant: { enabled: true },
  }), /App Check site key is required/i);
});
