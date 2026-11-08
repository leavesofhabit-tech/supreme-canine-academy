import { getApp, getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { createAcademyAccountClient, createAcademyAssistantClient } from "./academy-assistant-client.js";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

function localEmulator(value, label) {
  let url;
  try { url = new URL(String(value ?? "")); } catch { throw new Error(`${label} must be a loopback URL.`); }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must use localhost or a loopback address without a path.`);
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} requires an explicit port.`);
  return url;
}

function safeAuthMessage(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for that email. Sign in instead.",
    "auth/invalid-credential": "The email or password was not accepted.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Wait before trying again.",
    "auth/user-disabled": "This account is disabled. Contact the account owner.",
    "auth/operation-not-allowed": "Email/password sign-in is not enabled in the Firebase project.",
    "auth/network-request-failed": "Firebase could not be reached. Check the connection and try again.",
  };
  return messages[error?.code] ?? "Firebase sign-in could not be completed. Check the configuration and try again.";
}

function userSummary(user) {
  return { uid: user.uid, email: user.email ?? "", displayName: user.displayName ?? "" };
}

export async function createFirebaseRuntime(config = globalThis.SCA_CONFIG) {
  if (!config || !["authenticated", "emulator"].includes(config.mode)) return null;
  const values = config.firebase ?? {};
  if (!values.apiKey || !values.projectId || (config.mode === "authenticated" && !values.authDomain)) {
    throw new Error("Firebase Web config is incomplete.");
  }
  const assistantConfig = config.hostedAssistant ?? {};
  const hostedFunctionsEnabled = config.accountMetadataEnabled === true || assistantConfig.enabled === true;
  if (hostedFunctionsEnabled && config.mode === "authenticated" && !values.appCheckSiteKey) {
    throw new Error("Firebase App Check site key is required before hosted callables can be enabled.");
  }

  const app = getApps().length ? getApp() : initializeApp(values);
  const auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);
  if (config.mode === "emulator") {
    connectAuthEmulator(auth, localEmulator(values.authEmulatorUrl, "Auth emulator URL").origin, { disableWarnings: true });
  } else if (hostedFunctionsEnabled) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(values.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const functions = getFunctions(app, values.functionsRegion || "us-central1");
  if (config.mode === "emulator") {
    const endpoint = localEmulator(values.functionsEmulatorUrl, "Functions emulator URL");
    connectFunctionsEmulator(functions, endpoint.hostname, Number(endpoint.port));
  }

  const authClient = Object.freeze({
    async signIn(email, password) {
      try {
        const credential = await signInWithEmailAndPassword(auth, String(email).trim(), password);
        return { user: userSummary(credential.user), idToken: await credential.user.getIdToken(), expiresInSeconds: 3600 };
      } catch (error) { throw new Error(safeAuthMessage(error)); }
    },
    async createAccount(email, password, { displayName = "" } = {}) {
      let credential;
      try {
        credential = await createUserWithEmailAndPassword(auth, String(email).trim(), password);
      } catch (error) { throw new Error(safeAuthMessage(error)); }
      const username = String(displayName).trim().replace(/\s+/g, " ");
      if (username) {
        try { await updateProfile(credential.user, { displayName: username }); } catch { /* Auth account creation already succeeded. */ }
      }
      return {
        user: { ...userSummary(credential.user), displayName: username || credential.user.displayName || "" },
        idToken: await credential.user.getIdToken(),
        expiresInSeconds: 3600,
      };
    },
    async signOut() { await signOut(auth); },
    getCurrentUser() { return auth.currentUser; },
  });

  const accountClient = createAcademyAccountClient({
    enabled: config.accountMetadataEnabled === true,
    functions,
    httpsCallable,
    getCurrentUser: () => auth.currentUser,
  });
  const assistantClient = createAcademyAssistantClient({
    enabled: assistantConfig.enabled === true,
    endpointName: assistantConfig.endpointName || "academyAssistantDev",
    functions,
    httpsCallable,
    getCurrentUser: () => auth.currentUser,
    allowProduction: assistantConfig.allowProduction === true,
  });

  return Object.freeze({ authClient, accountClient, assistantClient, auth });
}
