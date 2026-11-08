const STORAGE_PREFIX = "sca.dog-profiles.v1.";
const STORAGE_UNAVAILABLE = "Dog profiles cannot be saved in this browser. Allow storage for this site and reload. You can still use the library.";

export function resolveProfileStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

export function profileStorageKey(scope = "local-review") {
  const safeScope = String(scope).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "local-review";
  return `${STORAGE_PREFIX}${safeScope}`;
}

export function readProfileState(storage, scope = "local-review") {
  const target = resolveProfileStorage(storage);
  if (!target || typeof target.getItem !== "function" || typeof target.setItem !== "function") {
    return { profiles: [], error: STORAGE_UNAVAILABLE };
  }
  try {
    const value = JSON.parse(target.getItem(profileStorageKey(scope)) ?? "[]");
    if (!Array.isArray(value) || value.some((profile) => !profile || typeof profile.id !== "string" || typeof profile.name !== "string")) {
      return { profiles: [], error: "Saved dog profiles could not be read. They have not been changed. Reload after checking this site's saved data." };
    }
    return { profiles: value, error: null };
  } catch {
    return { profiles: [], error: "Saved dog profiles could not be read. They have not been changed. Check this site's storage permissions and reload." };
  }
}

export function readProfiles(storage, scope = "local-review") {
  return readProfileState(storage, scope).profiles;
}

export function writeProfiles(profiles, storage, scope = "local-review") {
  if (!Array.isArray(profiles)) throw new TypeError("Dog profiles must be a list.");
  if (profiles.length > 30) throw new RangeError("You can save up to 30 dogs on this device. Remove a profile before adding another.");
  const target = resolveProfileStorage(storage);
  if (!target || typeof target.setItem !== "function") throw new Error(STORAGE_UNAVAILABLE);
  try {
    target.setItem(profileStorageKey(scope), JSON.stringify(profiles));
  } catch (error) {
    const message = error?.name === "QuotaExceededError"
      ? "This browser's storage is full. Your saved profiles have not changed. Free some site storage and try again."
      : "Your browser could not save this change. Your saved profiles have not changed. Check this site's storage permissions and try again.";
    throw new Error(message, { cause: error });
  }
  return profiles;
}

export function normalizeProfile(input) {
  const name = String(input?.name ?? "").trim().slice(0, 40);
  if (!name) throw new TypeError("Enter the dog's name.");
  return {
    id: String(input?.id || crypto.randomUUID()),
    name,
    age: String(input?.age ?? "").trim().slice(0, 40),
    breed: String(input?.breed ?? "").trim().slice(0, 60),
    goals: String(input?.goals ?? "").trim().slice(0, 240),
    setting: String(input?.setting ?? "").trim().slice(0, 120),
    comfort: String(input?.comfort ?? "").trim().slice(0, 120),
    updatedAt: new Date().toISOString()
  };
}

export function upsertProfile(profiles, input) {
  const profile = normalizeProfile(input);
  const index = profiles.findIndex((item) => item.id === profile.id);
  const next = [...profiles];
  if (index < 0) next.unshift(profile);
  else next[index] = profile;
  return next;
}

export function deleteProfile(profiles, id) {
  return profiles.filter((profile) => profile.id !== id);
}

export function selectProfile(profiles, id) {
  return profiles.find((profile) => profile.id === id) ?? null;
}
