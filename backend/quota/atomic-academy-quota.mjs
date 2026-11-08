const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  appKey: "supreme-canine-academy",
  dailyRequestLimit: 0,
  dailyTokenLimit: 0,
  perUserDailyRequestLimit: 0,
  perUserDailyTokenLimit: 0,
  maxInputTokensPerRequest: 0,
  maxOutputTokensPerRequest: 0,
  reservationTtlMs: 20 * 60 * 1000,
});

const CONFIG_LIMITS = [
  "dailyRequestLimit",
  "dailyTokenLimit",
  "perUserDailyRequestLimit",
  "perUserDailyTokenLimit",
  "maxInputTokensPerRequest",
  "maxOutputTokensPerRequest",
];

const RELEASE_REASONS = new Set([
  "pre-call-failure",
  "cancelled-before-call",
  "expired-before-call",
  "owner-disabled",
]);
const RELEASE_EVIDENCE = new Set([
  "pre-call-state-unstarted",
  "application-confirmed-no-model-call",
  "transport-confirmed-not-sent",
  "provider-confirmed-not-invoked",
]);
const RESERVATION_STATES = new Set(["reserved", "started", "unknown", "settled", "released"]);

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizedConfig(config) {
  return { ...DEFAULT_CONFIG, ...config };
}

function validateEnabledConfig(config) {
  if (typeof config.appKey !== "string" || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(config.appKey)) {
    throw new Error("academy-quota-app-key-invalid");
  }
  for (const key of CONFIG_LIMITS) {
    if (!isPositiveInteger(config[key])) throw new Error("academy-quota-config-limit-invalid:" + key);
  }
  if (!isPositiveInteger(config.reservationTtlMs) || config.reservationTtlMs > 24 * 60 * 60 * 1000) {
    throw new Error("academy-quota-reservation-ttl-invalid");
  }
  if (!Number.isSafeInteger(config.maxInputTokensPerRequest + config.maxOutputTokensPerRequest)) {
    throw new Error("academy-quota-per-request-bound-invalid");
  }
}

function dateKey(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("academy-quota-clock-invalid");
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function validReservationId(value) {
  return typeof value === "string" && value.length >= 16 && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function validUserKeyHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function reservationDocumentKey(appKey, reservationId) {
  return "academyQuotaReservations/" + appKey + "_" + reservationId;
}

function globalLedgerKey(appKey, date) {
  return "academyQuotaDaily/" + appKey + "_" + date + "_global";
}

function userLedgerKey(appKey, date, userKeyHash) {
  return "academyQuotaDaily/" + appKey + "_" + date + "_user_" + userKeyHash;
}

function emptyLedger(appKey, date) {
  return {
    version: 1,
    appKey,
    date,
    usedRequests: 0,
    reservedRequests: 0,
    usedTokens: 0,
    reservedTokens: 0,
    updatedAt: null,
  };
}

function readLedger(value, appKey, date) {
  if (value === undefined || value === null) return emptyLedger(appKey, date);
  if (value.appKey !== appKey || value.date !== date || value.version !== 1) return null;
  for (const key of ["usedRequests", "reservedRequests", "usedTokens", "reservedTokens"]) {
    if (!nonNegativeInteger(value[key])) return null;
  }
  if (
    !Number.isSafeInteger(value.usedRequests + value.reservedRequests)
    || !Number.isSafeInteger(value.usedTokens + value.reservedTokens)
  ) return null;
  return { ...value };
}

function withinBudget(used, reserved, additional, limit) {
  const alreadyAllocated = used + reserved;
  const total = alreadyAllocated + additional;
  return Number.isSafeInteger(alreadyAllocated) && Number.isSafeInteger(total) && total <= limit;
}

function validStoredReservation(value, appKey, reservationId) {
  if (
    !value
    || value.version !== 1
    || value.appKey !== appKey
    || value.reservationId !== reservationId
    || !/^\d{8}$/.test(value.date ?? "")
    || !validUserKeyHash(value.userKeyHash)
    || !positiveInteger(value.inputTokenUpperBound)
    || !positiveInteger(value.outputTokenCap)
    || !Number.isSafeInteger(value.inputTokenUpperBound + value.outputTokenCap)
    || !Number.isSafeInteger(value.reservedTokens)
    || value.reservedTokens !== value.inputTokenUpperBound + value.outputTokenCap
    || !RESERVATION_STATES.has(value.state)
    || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isFinite(Date.parse(value.expiresAt))
  ) return false;
  if ((value.state === "started" || value.state === "unknown") && !Number.isFinite(Date.parse(value.modelCallStartedAt))) {
    return false;
  }
  if (value.state === "settled" && (!Number.isFinite(Date.parse(value.settledAt)) || !value.settlement)) {
    return false;
  }
  if (
    value.state === "released"
    && (!Number.isFinite(Date.parse(value.releasedAt))
      || !RELEASE_REASONS.has(value.releaseReason)
      || !RELEASE_EVIDENCE.has(value.releaseEvidence))
  ) {
    return false;
  }
  if (value.state === "reserved" && value.modelCallStartedAt !== null) return false;
  return true;
}

function snapshotResult(reservation, extra = {}) {
  return {
    ok: true,
    reservationId: reservation.reservationId,
    state: reservation.state,
    reservedTokens: reservation.reservedTokens,
    expiresAt: reservation.expiresAt,
    ...extra,
  };
}

function validateStore(store) {
  if (!store || typeof store.runTransaction !== "function") {
    throw new Error("academy-quota-transaction-store-required");
  }
}

/**
 * Server-side quota mechanism prototype. The store adapter must provide
 * serializable, atomic transactions across every key read and written.
 * It deliberately has no Firebase dependency and defaults to disabled.
 */
export function createAtomicAcademyQuotaManager({
  store,
  config = DEFAULT_CONFIG,
  clock = () => new Date(),
} = {}) {
  const effective = normalizedConfig(config);
  if (effective.enabled !== true) {
    const disabled = async () => ({ ok: false, reason: "quota-disabled" });
    return Object.freeze({
      enabled: false,
      reserve: disabled,
      markModelCallStarted: disabled,
      settleUsage: disabled,
      releaseBeforeModel: disabled,
      reconcile: disabled,
    });
  }

  validateEnabledConfig(effective);
  validateStore(store);
  if (typeof clock !== "function") throw new Error("academy-quota-clock-required");

  async function transact(work) {
    try {
      return await store.runTransaction(work);
    } catch {
      return { ok: false, reason: "quota-store-unavailable" };
    }
  }

  function nowValue() {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error("academy-quota-clock-invalid");
    }
    return now;
  }

  async function readReservation(tx, reservationId) {
    if (!validReservationId(reservationId)) return { error: "invalid-reservation-id" };
    const value = await tx.get(reservationDocumentKey(effective.appKey, reservationId));
    if (!value) return { error: "reservation-not-found" };
    if (!validStoredReservation(value, effective.appKey, reservationId)) {
      return { error: "reservation-record-invalid" };
    }
    return { reservation: value };
  }

  async function reserve({
    reservationId,
    userKeyHash,
    inputTokenUpperBound,
    outputTokenCap,
  } = {}) {
    if (
      !validReservationId(reservationId)
      || !validUserKeyHash(userKeyHash)
      || !positiveInteger(inputTokenUpperBound)
      || !positiveInteger(outputTokenCap)
      || inputTokenUpperBound > effective.maxInputTokensPerRequest
      || outputTokenCap > effective.maxOutputTokensPerRequest
      || !Number.isSafeInteger(inputTokenUpperBound + outputTokenCap)
    ) {
      return { ok: false, reason: "invalid-reservation-request" };
    }

    const now = nowValue();
    const today = dateKey(now);
    const reservedTokens = inputTokenUpperBound + outputTokenCap;
    const reservationKey = reservationDocumentKey(effective.appKey, reservationId);
    const globalKey = globalLedgerKey(effective.appKey, today);
    const userKey = userLedgerKey(effective.appKey, today, userKeyHash);

    return transact(async (tx) => {
      const existing = await tx.get(reservationKey);
      if (existing) {
        if (!validStoredReservation(existing, effective.appKey, reservationId)) {
          return { ok: false, reason: "reservation-record-invalid" };
        }
        const sameRequest = existing.userKeyHash === userKeyHash
          && existing.inputTokenUpperBound === inputTokenUpperBound
          && existing.outputTokenCap === outputTokenCap;
        if (!sameRequest) return { ok: false, reason: "reservation-idempotency-conflict" };
        return snapshotResult(existing, { idempotent: true, shouldInvokeModel: false });
      }

      const rawGlobal = await tx.get(globalKey);
      const rawUser = await tx.get(userKey);
      const global = readLedger(rawGlobal, effective.appKey, today);
      const user = readLedger(rawUser, effective.appKey, today);
      if (!global || !user) return { ok: false, reason: "quota-ledger-invalid" };

      if (!withinBudget(global.usedRequests, global.reservedRequests, 1, effective.dailyRequestLimit)) {
        return { ok: false, reason: "global-daily-request-limit" };
      }
      if (!withinBudget(user.usedRequests, user.reservedRequests, 1, effective.perUserDailyRequestLimit)) {
        return { ok: false, reason: "user-daily-request-limit" };
      }
      if (!withinBudget(global.usedTokens, global.reservedTokens, reservedTokens, effective.dailyTokenLimit)) {
        return { ok: false, reason: "global-daily-token-limit" };
      }
      if (!withinBudget(user.usedTokens, user.reservedTokens, reservedTokens, effective.perUserDailyTokenLimit)) {
        return { ok: false, reason: "user-daily-token-limit" };
      }

      const timestamp = now.toISOString();
      const expiresAt = new Date(now.getTime() + effective.reservationTtlMs).toISOString();
      const reservation = {
        version: 1,
        appKey: effective.appKey,
        reservationId,
        date: today,
        userKeyHash,
        inputTokenUpperBound,
        outputTokenCap,
        reservedTokens,
        state: "reserved",
        createdAt: timestamp,
        expiresAt,
        modelCallStartedAt: null,
        settledAt: null,
        settlement: null,
        releasedAt: null,
        releaseReason: null,
        releaseEvidence: null,
      };

      tx.set(globalKey, {
        ...global,
        reservedRequests: global.reservedRequests + 1,
        reservedTokens: global.reservedTokens + reservedTokens,
        updatedAt: timestamp,
      });
      tx.set(userKey, {
        ...user,
        reservedRequests: user.reservedRequests + 1,
        reservedTokens: user.reservedTokens + reservedTokens,
        updatedAt: timestamp,
      });
      tx.set(reservationKey, reservation);
      return snapshotResult(reservation, { idempotent: false, shouldInvokeModel: false });
    });
  }

  async function markModelCallStarted({ reservationId } = {}) {
    if (!validReservationId(reservationId)) return { ok: false, reason: "invalid-reservation-id" };
    const now = nowValue();
    const key = reservationDocumentKey(effective.appKey, reservationId);
    return transact(async (tx) => {
      const loaded = await readReservation(tx, reservationId);
      if (loaded.error) return { ok: false, reason: loaded.error };
      const reservation = loaded.reservation;
      if (reservation.state !== "reserved") {
        return { ok: false, reason: "model-call-not-authorized", state: reservation.state };
      }
      if (Date.parse(reservation.expiresAt) <= now.getTime()) {
        return { ok: false, reason: "reservation-expired" };
      }
      const started = {
        ...reservation,
        state: "started",
        modelCallStartedAt: now.toISOString(),
      };
      tx.set(key, started);
      return { ok: true, shouldInvokeModel: true, state: "started" };
    });
  }

  async function releaseKnownNotInvoked({
    reservationId,
    reason,
    evidence,
    allowAfterStart = false,
  } = {}) {
    if (!validReservationId(reservationId)) return { ok: false, reason: "invalid-reservation-id" };
    if (!RELEASE_REASONS.has(reason)) return { ok: false, reason: "release-reason-invalid" };
    if (!RELEASE_EVIDENCE.has(evidence)) return { ok: false, reason: "release-evidence-invalid" };
    const now = nowValue();
    const reservationKey = reservationDocumentKey(effective.appKey, reservationId);
    return transact(async (tx) => {
      const loaded = await readReservation(tx, reservationId);
      if (loaded.error) return { ok: false, reason: loaded.error };
      const reservation = loaded.reservation;
      if (reservation.state === "released") {
        return snapshotResult(reservation, { idempotent: true });
      }
      const mayRelease = reservation.state === "reserved"
        || (allowAfterStart && (reservation.state === "started" || reservation.state === "unknown"));
      if (!mayRelease) {
        return { ok: false, reason: "cannot-release-after-model-call-start", state: reservation.state };
      }

      const globalKey = globalLedgerKey(effective.appKey, reservation.date);
      const userKey = userLedgerKey(effective.appKey, reservation.date, reservation.userKeyHash);
      const rawGlobal = await tx.get(globalKey);
      const rawUser = await tx.get(userKey);
      const global = readLedger(rawGlobal, effective.appKey, reservation.date);
      const user = readLedger(rawUser, effective.appKey, reservation.date);
      if (!global || !user) return { ok: false, reason: "quota-ledger-invalid" };
      if (
        global.reservedRequests < 1 || user.reservedRequests < 1
        || global.reservedTokens < reservation.reservedTokens
        || user.reservedTokens < reservation.reservedTokens
      ) return { ok: false, reason: "quota-ledger-invariant-failed" };

      const timestamp = now.toISOString();
      const released = {
        ...reservation,
        state: "released",
        releasedAt: timestamp,
        releaseReason: reason,
        releaseEvidence: evidence,
      };
      tx.set(globalKey, {
        ...global,
        reservedRequests: global.reservedRequests - 1,
        reservedTokens: global.reservedTokens - reservation.reservedTokens,
        updatedAt: timestamp,
      });
      tx.set(userKey, {
        ...user,
        reservedRequests: user.reservedRequests - 1,
        reservedTokens: user.reservedTokens - reservation.reservedTokens,
        updatedAt: timestamp,
      });
      tx.set(reservationKey, released);
      return snapshotResult(released, { idempotent: false, releasedTokens: reservation.reservedTokens });
    });
  }

  async function releaseBeforeModel({ reservationId, reason } = {}) {
    return releaseKnownNotInvoked({
      reservationId,
      reason,
      evidence: "pre-call-state-unstarted",
      allowAfterStart: false,
    });
  }

  async function applySettlement(tx, reservation, settlement, now) {
    const reservationKey = reservationDocumentKey(effective.appKey, reservation.reservationId);
    if (reservation.state === "settled") {
      const same = JSON.stringify(reservation.settlement) === JSON.stringify(settlement);
      if (!same) return { ok: false, reason: "settlement-idempotency-conflict" };
      return snapshotResult(reservation, { idempotent: true, overrun: reservation.overrun === true });
    }
    if (reservation.state === "released") {
      return { ok: false, reason: "reservation-already-released" };
    }
    if (reservation.state !== "started" && reservation.state !== "unknown") {
      return { ok: false, reason: "model-call-not-started" };
    }

    const globalKey = globalLedgerKey(effective.appKey, reservation.date);
    const userKey = userLedgerKey(effective.appKey, reservation.date, reservation.userKeyHash);
    const rawGlobal = await tx.get(globalKey);
    const rawUser = await tx.get(userKey);
    const global = readLedger(rawGlobal, effective.appKey, reservation.date);
    const user = readLedger(rawUser, effective.appKey, reservation.date);
    if (!global || !user) return { ok: false, reason: "quota-ledger-invalid" };
    if (
      global.reservedRequests < 1 || user.reservedRequests < 1
      || global.reservedTokens < reservation.reservedTokens
      || user.reservedTokens < reservation.reservedTokens
    ) return { ok: false, reason: "quota-ledger-invariant-failed" };

    const actualTokens = settlement.inputTokens + settlement.outputTokens;
    const overrun = actualTokens > reservation.reservedTokens;
    if (
      !Number.isSafeInteger(global.usedTokens + actualTokens)
      || !Number.isSafeInteger(user.usedTokens + actualTokens)
      || !Number.isSafeInteger(global.usedRequests + 1)
      || !Number.isSafeInteger(user.usedRequests + 1)
    ) return { ok: false, reason: "quota-counter-overflow" };
    const timestamp = now.toISOString();
    const settled = {
      ...reservation,
      state: "settled",
      settledAt: timestamp,
      settlement,
      overrun,
    };
    tx.set(globalKey, {
      ...global,
      reservedRequests: global.reservedRequests - 1,
      reservedTokens: global.reservedTokens - reservation.reservedTokens,
      usedRequests: global.usedRequests + 1,
      usedTokens: global.usedTokens + actualTokens,
      updatedAt: timestamp,
    });
    tx.set(userKey, {
      ...user,
      reservedRequests: user.reservedRequests - 1,
      reservedTokens: user.reservedTokens - reservation.reservedTokens,
      usedRequests: user.usedRequests + 1,
      usedTokens: user.usedTokens + actualTokens,
      updatedAt: timestamp,
    });
    tx.set(reservationKey, settled);
    return {
      ok: !overrun,
      reason: overrun ? "usage-exceeded-reservation" : undefined,
      reservationId: reservation.reservationId,
      state: "settled",
      idempotent: false,
      overrun,
      actualTokens,
      releasedUnusedTokens: Math.max(0, reservation.reservedTokens - actualTokens),
    };
  }

  async function settleUsage({ reservationId, inputTokens, outputTokens } = {}) {
    if (
      !validReservationId(reservationId)
      || !nonNegativeInteger(inputTokens)
      || !nonNegativeInteger(outputTokens)
      || !Number.isSafeInteger(inputTokens + outputTokens)
    ) return { ok: false, reason: "usage-invalid" };
    const now = nowValue();
    return transact(async (tx) => {
      const loaded = await readReservation(tx, reservationId);
      if (loaded.error) return { ok: false, reason: loaded.error };
      return applySettlement(tx, loaded.reservation, {
        kind: "usage",
        inputTokens,
        outputTokens,
      }, now);
    });
  }

  async function reconcile({
    reservationId,
    outcome,
    evidence,
    inputTokens,
    outputTokens,
  } = {}) {
    if (!validReservationId(reservationId)) return { ok: false, reason: "invalid-reservation-id" };
    if (outcome === "usage-known") return settleUsage({ reservationId, inputTokens, outputTokens });
    if (outcome === "not-invoked") {
      if (evidence === "application-confirmed-no-model-call") {
        return releaseKnownNotInvoked({
          reservationId,
          reason: "pre-call-failure",
          evidence,
          allowAfterStart: false,
        });
      }
      if (evidence === "transport-confirmed-not-sent" || evidence === "provider-confirmed-not-invoked") {
        return releaseKnownNotInvoked({
          reservationId,
          reason: "pre-call-failure",
          evidence,
          allowAfterStart: true,
        });
      }
      if (evidence !== "application-confirmed-no-model-call") {
        return { ok: false, reason: "reconciliation-evidence-required" };
      }
    }
    const now = nowValue();
    const reservationKey = reservationDocumentKey(effective.appKey, reservationId);

    if (outcome === "unknown") {
      return transact(async (tx) => {
        const loaded = await readReservation(tx, reservationId);
        if (loaded.error) return { ok: false, reason: loaded.error };
        const reservation = loaded.reservation;
        if (reservation.state === "unknown") {
          return snapshotResult(reservation, { idempotent: true, reconciliationRequired: true });
        }
        if (reservation.state !== "started") {
          return { ok: false, reason: "unknown-outcome-requires-started-call", state: reservation.state };
        }
        const unknown = { ...reservation, state: "unknown", reconciliationRequiredAt: now.toISOString() };
        tx.set(reservationKey, unknown);
        return snapshotResult(unknown, { idempotent: false, reconciliationRequired: true });
      });
    }

    if (outcome === "no-billable-usage") {
      if (evidence !== "provider-confirmed-no-charge") {
        return { ok: false, reason: "reconciliation-evidence-required" };
      }
      return transact(async (tx) => {
        const loaded = await readReservation(tx, reservationId);
        if (loaded.error) return { ok: false, reason: loaded.error };
        return applySettlement(tx, loaded.reservation, {
          kind: "no-billable-usage",
          evidence,
          inputTokens: 0,
          outputTokens: 0,
        }, now);
      });
    }
    return { ok: false, reason: "reconciliation-outcome-invalid" };
  }

  return Object.freeze({
    enabled: true,
    appKey: effective.appKey,
    reserve,
    markModelCallStarted,
    settleUsage,
    releaseBeforeModel,
    reconcile,
  });
}

export { DEFAULT_CONFIG as DEFAULT_ACADEMY_QUOTA_CONFIG };
