import test from "node:test";
import assert from "node:assert/strict";
import { observeAppStatus } from "../src/app-status.js";

function setup(controller = null) {
  const worker = new EventTarget();
  worker.controller = controller;
  const events = new EventTarget();
  let online = true;
  let registrations = 0;
  let updates = 0;
  let updateNotices = 0;
  const connection = [];
  worker.register = async (path, options) => {
    assert.equal(path, "/service-worker.js");
    assert.deepEqual(options, { scope: "/", updateViaCache: "none" });
    registrations += 1;
    return { update: async () => { updates += 1; } };
  };
  return {
    worker, events, connection,
    options: { serviceWorker: worker, events, isOnline: () => online, onOffline: value => connection.push(value), onUpdateReady: () => { updateNotices += 1; } },
    setOnline(value) { online = value; events.dispatchEvent(new Event(value ? "online" : "offline")); },
    get counts() { return { registrations, updates, updateNotices }; },
  };
}

test("connection status follows offline/reconnect and reconnect checks for a missed release", async () => {
  const state = setup();
  await observeAppStatus(state.options);
  state.setOnline(false);
  state.setOnline(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.connection, [false, true, false]);
  assert.deepEqual(state.counts, { registrations: 1, updates: 1, updateNotices: 0 });
});

test("a first offline installation never prompts a reload, while a changed controller does", async () => {
  const state = setup();
  await observeAppStatus(state.options);
  state.worker.controller = { version: "first" };
  state.worker.dispatchEvent(new Event("controllerchange"));
  state.worker.dispatchEvent(new Event("controllerchange"));
  assert.equal(state.counts.updateNotices, 0);
  state.worker.controller = { version: "next" };
  state.worker.dispatchEvent(new Event("controllerchange"));
  assert.equal(state.counts.updateNotices, 1);
});

test("an existing controlled page gets an update notice without reloading itself", async () => {
  const state = setup({ version: "old" });
  await observeAppStatus(state.options);
  state.worker.controller = { version: "new" };
  state.worker.dispatchEvent(new Event("controllerchange"));
  assert.equal(state.counts.updateNotices, 1);
});

test("connection status works without worker support and survives failed registration/update", async () => {
  const unsupported = setup();
  assert.equal(await observeAppStatus({ ...unsupported.options, serviceWorker: null }), null);
  unsupported.setOnline(false);
  assert.deepEqual(unsupported.connection, [false, true]);

  const unavailable = setup();
  unavailable.worker.register = async () => { throw new Error("Storage blocked"); };
  await assert.rejects(observeAppStatus(unavailable.options), /Storage blocked/);
  unavailable.setOnline(false);
  unavailable.setOnline(true);
  assert.deepEqual(unavailable.connection, [false, true, false]);

  const offlineUpdate = setup();
  offlineUpdate.worker.register = async () => ({ update: async () => { throw new Error("Network down"); } });
  await observeAppStatus(offlineUpdate.options);
  offlineUpdate.setOnline(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(offlineUpdate.counts.updateNotices, 0);
});
