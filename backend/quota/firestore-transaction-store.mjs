const ALLOWED_DOCUMENT_PATH = /^academyQuota(?:Reservations|Daily)\/[A-Za-z0-9_-]{1,180}$/;

function requiredPath(path) {
  if (typeof path !== "string" || !ALLOWED_DOCUMENT_PATH.test(path)) {
    throw new Error("academy-quota-document-path-invalid");
  }
  return path;
}

/** Narrow Firestore adapter for the standalone atomic quota prototype. */
export function createFirestoreQuotaTransactionStore(db) {
  if (!db || typeof db.runTransaction !== "function" || typeof db.doc !== "function") {
    throw new Error("academy-quota-firestore-database-required");
  }
  return Object.freeze({
    async runTransaction(work) {
      if (typeof work !== "function") throw new Error("academy-quota-transaction-work-required");
      return db.runTransaction(async (firestoreTransaction) => work(Object.freeze({
        async get(path) {
          const snapshot = await firestoreTransaction.get(db.doc(requiredPath(path)));
          return snapshot.exists ? snapshot.data() : undefined;
        },
        set(path, value) {
          firestoreTransaction.set(db.doc(requiredPath(path)), value);
        },
      })));
    },
  });
}
