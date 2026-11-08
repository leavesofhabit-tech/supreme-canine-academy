import test from "node:test";
import assert from "node:assert/strict";
import { deleteProfile, profileStorageKey, readProfiles, readProfileState, resolveProfileStorage, upsertProfile, writeProfiles } from "../src/profiles.js";

test("blocked browser storage is a recoverable profile state and cannot report a successful save", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("Blocked", "SecurityError"); } });
    assert.equal(resolveProfileStorage(), null);
    assert.deepEqual(readProfiles(), []);
    assert.match(readProfileState().error, /allow storage.*reload/i);
    assert.throws(() => writeProfiles([]), /cannot be saved/i);
    assert.throws(() => writeProfiles([], null), /cannot be saved/i);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("a quota failure preserves stored data and the prior immutable save/delete candidates", () => {
  const current = upsertProfile([], { id: "existing", name: "Milo", goals: "mat" });
  const savedBytes = JSON.stringify(current);
  const storage = {
    getItem: () => savedBytes,
    setItem() { throw new DOMException("Quota exceeded", "QuotaExceededError"); },
  };
  const edited = upsertProfile(current, { ...current[0], goals: "recall" });
  const removed = deleteProfile(current, "existing");
  assert.throws(() => writeProfiles(edited, storage), /storage is full.*not changed/i);
  assert.throws(() => writeProfiles(removed, storage), /storage is full.*not changed/i);
  assert.equal(current[0].goals, "mat");
  assert.equal(current.length, 1);
  assert.equal(storage.getItem(), savedBytes);
  assert.deepEqual(readProfileState(storage).profiles, current);
});

test("the 30-profile limit permits edits and rejects an additional profile before writing", () => {
  let persisted;
  const storage = { getItem: () => persisted ?? null, setItem: (_key, value) => { persisted = value; } };
  const current = Array.from({ length: 30 }, (_, index) => ({ id: `dog-${index}`, name: `Dog ${index}` }));
  writeProfiles(current, storage);
  const edited = upsertProfile(current, { id: "dog-0", name: "Updated dog" });
  writeProfiles(edited, storage);
  const lastSaved = persisted;
  assert.equal(readProfiles(storage)[0].name, "Updated dog");
  assert.throws(() => writeProfiles(upsertProfile(edited, { id: "dog-31", name: "Extra" }), storage), /up to 30.*remove/i);
  assert.equal(persisted, lastSaved);
});

test("unreadable or malformed profiles provide an error and preserve the original bytes", () => {
  const key = profileStorageKey();
  for (const raw of ["{broken", "{}", '[{"id":"missing-name"}]']) {
    const values = new Map([[key, raw]]);
    const storage = { getItem: (name) => values.get(name) ?? null, setItem: (name, value) => values.set(name, value) };
    const state = readProfileState(storage);
    assert.deepEqual(state.profiles, []);
    assert.match(state.error, /could not be read.*not been changed/i);
    assert.equal(values.get(key), raw);
  }
  const denied = { getItem() { throw new DOMException("Denied", "SecurityError"); }, setItem() {} };
  assert.match(readProfileState(denied).error, /storage permissions/i);
});
