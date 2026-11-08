import test from "node:test";
import assert from "node:assert/strict";
import { createFirestoreQuotaTransactionStore } from "../quota/firestore-transaction-store.mjs";
import { createAtomicAcademyQuotaManager } from "../quota/atomic-academy-quota.mjs";

function memoryFirestore() {
  const values = new Map();
  const db = {
    doc(path) { return { path }; },
    async runTransaction(work) {
      const writes = new Map();
      const transaction = {
        async get(reference) {
          const value = writes.has(reference.path) ? writes.get(reference.path) : values.get(reference.path);
          return { exists: value !== undefined, data: () => value };
        },
        set(reference, value) { writes.set(reference.path, structuredClone(value)); },
      };
      const result = await work(transaction);
      for (const [path, value] of writes) values.set(path, value);
      return result;
    },
  };
  return { db, values };
}

test("quota Firestore adapter scopes paths and executes a reservation lifecycle transaction", async () => {
  const { db, values } = memoryFirestore();
  const store = createFirestoreQuotaTransactionStore(db);
  const manager = createAtomicAcademyQuotaManager({
    store,
    config: {
      enabled: true,
      dailyRequestLimit: 10,
      dailyTokenLimit: 1000,
      perUserDailyRequestLimit: 3,
      perUserDailyTokenLimit: 500,
      maxInputTokensPerRequest: 300,
      maxOutputTokensPerRequest: 100,
    },
    clock: () => new Date("2026-11-04T12:00:00.000Z"),
  });
  const reservation = await manager.reserve({ reservationId: "test-reservation-0001", userKeyHash: "a".repeat(64), inputTokenUpperBound: 80, outputTokenCap: 20 });
  assert.equal(reservation.ok, true);
  assert.equal((await manager.markModelCallStarted({ reservationId: reservation.reservationId })).ok, true);
  const settlement = await manager.settleUsage({ reservationId: reservation.reservationId, inputTokens: 60, outputTokens: 15 });
  assert.equal(settlement.ok, true);
  assert.equal(settlement.releasedUnusedTokens, 25);
  assert.ok([...values.keys()].every((path) => path.startsWith("academyQuota")));
  await assert.rejects(store.runTransaction((tx) => tx.get("unrelatedCollection/private-doc")), /academy-quota-document-path-invalid/);
});
