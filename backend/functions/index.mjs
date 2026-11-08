import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import {
  ACADEMY_DEV_COLLECTION,
  ACADEMY_PROD_COLLECTION,
  createAcademyBackend,
  createFirestoreAcademyRepositories,
} from "../academy-core.mjs";
import { createFirebaseAcademyFunctions } from "../firebase-adapter.mjs";

const firebaseApp = getApps().length ? getApp() : initializeApp();
const database = getFirestore(firebaseApp);
const repositories = createFirestoreAcademyRepositories({ db: database, fieldValue: FieldValue });

const accountsBackend = createAcademyBackend({
  ...repositories,
  enabled: process.env.SCA_ACCOUNT_METADATA_ENABLED === "true",
  collectionName: ACADEMY_DEV_COLLECTION,
});
const devBackend = createAcademyBackend({
  ...repositories,
  enabled: process.env.SCA_ASSISTANT_DEV_ENABLED === "true",
  collectionName: ACADEMY_DEV_COLLECTION,
});
const prodBackend = createAcademyBackend({
  ...repositories,
  enabled: process.env.SCA_ASSISTANT_PROD_ENABLED === "true",
  collectionName: ACADEMY_PROD_COLLECTION,
});

const exports = createFirebaseAcademyFunctions({
  onCall,
  HttpsError,
  accountBackend: accountsBackend,
  devBackend,
  prodBackend,
});

export const academyAccountSync = exports.academyAccountSync;
export const academyAccountCounts = exports.academyAccountCounts;
export const academyAssistantDev = exports.academyAssistantDev;
export const academyAssistant = exports.academyAssistant;
