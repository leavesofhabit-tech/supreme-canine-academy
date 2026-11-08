import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8");
const origin = "https://supreme-canine-academy.web.app";
const publicShell = [
  "/", "/index.html", "/config.js", "/app.bundle.js", "/src/styles.css",
  "/manifest.webmanifest", "/icons/academy-canine-2026.png", "/data/knowledge.json",
];

// Node-created responses have type "default". Browser same-origin fetches have
// type "basic", so expose that browser result at the mocked network boundary.
function networkResponse(body = "Network content", { status = 200, type = "basic" } = {}) {
  const response = new Response(body, { status });
  Object.defineProperty(response, "type", { value: type });
  return response;
}

function worker({ openError, matchError, putError, match, fetch: networkFetch } = {}) {
  const handlers = new Map();
  const state = {
    opened: [], matches: [], puts: [], added: [], fetched: [], deleted: [],
    keys: [], lifecycle: [], skipped: 0, claimed: 0,
  };
  const cache = {
    async addAll(paths) { state.added.push(Array.from(paths)); },
    async match(request, options) {
      state.matches.push({ request, options });
      if (matchError) throw new Error("Cache lookup is unavailable");
      return match?.(request, options);
    },
    async put(request, response) {
      state.puts.push({ request, response });
      if (putError) throw new Error("Cache storage is full");
    },
  };
  const context = vm.createContext({
    URL, Response,
    self: {
      location: { origin },
      addEventListener(name, callback) { handlers.set(name, callback); },
      async skipWaiting() { state.skipped += 1; },
      clients: { async claim() { state.claimed += 1; state.lifecycle.push("claim"); } },
    },
    caches: {
      async open(name) {
        state.opened.push(name);
        if (openError) throw new Error("Cache access is blocked");
        return cache;
      },
      async keys() { return state.keys; },
      async delete(name) {
        state.deleted.push(name);
        state.lifecycle.push(`delete:${name}`);
        return true;
      },
    },
    async fetch(request) {
      state.fetched.push(request);
      return networkFetch ? networkFetch(request) : networkResponse();
    },
  });
  vm.runInContext(source, context, { filename: "service-worker.js" });

  return {
    state,
    async lifecycle(name) {
      let pending;
      handlers.get(name)({ waitUntil(value) { pending = Promise.resolve(value); } });
      assert.ok(pending, `${name} must keep its asynchronous work alive`);
      await pending;
    },
    async request(path, { method = "GET", mode = "cors" } = {}) {
      const request = { url: new URL(path, origin).href, method, mode };
      let pending;
      handlers.get("fetch")({
        request,
        respondWith(value) { pending = Promise.resolve(value); },
      });
      return { intercepted: Boolean(pending), response: pending ? await pending : undefined, request };
    },
  };
}

test("service worker installs only the bounded public shell before activating", async () => {
  const app = worker();
  await app.lifecycle("install");
  assert.equal(app.state.opened.length, 1);
  assert.match(app.state.opened[0], /^sca-backend-review-/);
  assert.deepEqual(app.state.added, [publicShell]);
  assert.equal(app.state.skipped, 1);
});

test("service worker leaves build identity, private/API routes, foreign origins, and writes to the browser", async () => {
  const app = worker();
  const requests = [
    ["/BUILD-INFO.json"], ["/BUILD-INFO.json?check=latest"],
    ["/api/health"], ["/api/account"], ["/account/profile.json"],
    ["/private/messages.json"], ["/future-asset.js"],
    ["https://other.example/app.bundle.js"],
    ["/data/knowledge.json", { method: "POST" }],
    ["/", { method: "HEAD" }],
  ];
  for (const [path, options] of requests) {
    const result = await app.request(path, options);
    assert.equal(result.intercepted, false, path);
  }
  assert.equal(app.state.opened.length, 0);
  assert.equal(app.state.fetched.length, 0);
  assert.equal(app.state.puts.length, 0);
});

test("cached public resources work without the network and ignore release query strings", async () => {
  const cached = networkResponse("Cached application bundle");
  const app = worker({
    match: () => cached,
    fetch: () => { throw new Error("Offline"); },
  });
  const result = await app.request("/app.bundle.js?release=latest");
  assert.equal(result.intercepted, true);
  assert.equal(result.response, cached);
  assert.equal(await result.response.text(), "Cached application bundle");
  assert.equal(app.state.matches[0].options.ignoreSearch, true);
  assert.equal(app.state.fetched.length, 0);
});

test("a public-shell cache miss returns the original network response and caches a readable clone", async () => {
  const response = networkResponse("Fresh stylesheet");
  const app = worker({ fetch: () => response });
  const result = await app.request("/src/styles.css");
  assert.equal(result.response, response);
  assert.equal(app.state.fetched.length, 1);
  assert.equal(app.state.puts.length, 1);
  assert.equal(app.state.puts[0].request, result.request);
  assert.notEqual(app.state.puts[0].response, response);
  assert.equal(await app.state.puts[0].response.text(), "Fresh stylesheet");
  assert.equal(await result.response.text(), "Fresh stylesheet");
});

test("cache access, lookup, and write failures each preserve a usable network response", async (t) => {
  for (const failure of ["openError", "matchError", "putError"]) {
    await t.test(failure, async () => {
      const response = networkResponse(`Usable despite ${failure}`);
      const app = worker({ [failure]: true, fetch: () => response });
      const result = await app.request("/index.html", { mode: "navigate" });
      assert.equal(result.response, response);
      assert.equal(result.response.status, 200);
      assert.equal(await result.response.text(), `Usable despite ${failure}`);
      assert.equal(app.state.fetched.length, 1);
    });
  }
});

test("offline navigation falls back to the cached shell document", async () => {
  const fallback = networkResponse("Cached home screen");
  const app = worker({
    match: (request) => request === "/index.html" ? fallback : undefined,
    fetch: () => { throw new Error("Offline"); },
  });
  const result = await app.request("/", { mode: "navigate" });
  assert.equal(result.response, fallback);
  assert.equal(await result.response.text(), "Cached home screen");
  assert.equal(app.state.fetched.length, 1);
  assert.equal(app.state.matches.at(-1).request, "/index.html");
});

test("offline asset misses return an explicit 503 rather than HTML", async () => {
  const app = worker({ fetch: () => { throw new Error("Offline"); } });
  const result = await app.request("/src/styles.css");
  assert.equal(result.response.status, 503);
  assert.equal(await result.response.text(), "Offline resource unavailable");
  assert.equal(app.state.matches.length, 1);
});

test("offline navigation with a blocked or missing fallback returns a controlled 503", async (t) => {
  for (const failure of ["openError", "matchError", "missingFallback"]) {
    await t.test(failure, async () => {
      const app = worker({ [failure]: true, fetch: () => { throw new Error("Offline"); } });
      const result = await app.request("/", { mode: "navigate" });
      assert.equal(result.response.status, 503);
      assert.equal(await result.response.text(), "Offline resource unavailable");
    });
  }
});

test("unsuccessful or non-basic network responses are delivered without entering the shell cache", async (t) => {
  for (const options of [{ status: 503, type: "basic" }, { status: 200, type: "cors" }]) {
    await t.test(`${options.status} ${options.type}`, async () => {
      const response = networkResponse("Original response", options);
      const app = worker({ fetch: () => response });
      const result = await app.request("/data/knowledge.json");
      assert.equal(result.response, response);
      assert.equal(await result.response.text(), "Original response");
      assert.equal(app.state.puts.length, 0);
    });
  }
});

test("activation removes only obsolete Academy caches and claims clients afterward", async () => {
  const app = worker();
  await app.lifecycle("install");
  const current = app.state.opened[0];
  app.state.keys = [
    current, "sca-review-legacy", "sca-backend-review-obsolete",
    "another-app-v1", "workbox-precache-v2", "backup-sca-review-legacy", "sca-shared-data",
  ];
  await app.lifecycle("activate");
  assert.deepEqual(app.state.deleted.sort(), ["sca-backend-review-obsolete", "sca-review-legacy"]);
  assert.ok(!app.state.deleted.includes(current));
  assert.equal(app.state.claimed, 1);
  assert.equal(app.state.lifecycle.at(-1), "claim");
});
