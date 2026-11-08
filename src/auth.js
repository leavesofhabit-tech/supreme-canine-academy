const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

function validLocalEmulatorUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "http:"
      && LOOPBACK.has(url.hostname)
      && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash
      && Number.isInteger(Number(url.port)) && Number(url.port) > 0 && Number(url.port) <= 65535;
  } catch {
    return false;
  }
}

export function authConfigured(config = globalThis.SCA_CONFIG?.firebase, mode = globalThis.SCA_CONFIG?.mode) {
  const apiKey = String(config?.apiKey ?? "").trim();
  const authDomain = String(config?.authDomain ?? "").trim();
  const projectId = String(config?.projectId ?? "").trim();
  if (mode === "emulator") return Boolean(apiKey && projectId && validLocalEmulatorUrl(config?.authEmulatorUrl));
  return mode === "authenticated" && Boolean(apiKey && authDomain && projectId);
}

export function authConfigStatus(config = globalThis.SCA_CONFIG?.firebase, mode = globalThis.SCA_CONFIG?.mode) {
  if (mode !== "authenticated" && mode !== "emulator") {
    return { configured: false, message: "Firebase Auth is disabled in local-review mode." };
  }
  if (!authConfigured(config, mode)) {
    return { configured: false, message: "Firebase Web config is incomplete. Local review mode remains available." };
  }
  return mode === "emulator"
    ? { configured: true, message: "Local Firebase Auth Emulator is configured. No production account will be contacted." }
    : { configured: true, message: "Firebase Auth config is present. Sign-in still requires a valid Firebase Auth account." };
}
