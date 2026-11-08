import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSearchIndex, classifySafety, buildAnswer, OWNER_MARKERS, OWNER_POSITION_RULE } from "../src/retrieval.js";
import { buildSourceAnswer } from "../src/source-answer.js";
import { authConfigStatus, authConfigured } from "../src/auth.js";
import { deleteProfile, profileStorageKey, readProfiles, upsertProfile, writeProfiles } from "../src/profiles.js";

const corpus = JSON.parse(await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8"));
const benchmark = JSON.parse(await readFile(new URL("./rag_cases.json", import.meta.url), "utf8"));
const index = createSearchIndex(corpus.records);

test("the web payload contains the exact review corpus boundary", () => {
  assert.equal(corpus.records.length, 67);
  assert.equal(corpus.production_eligible_count, 0);
  assert.ok(corpus.records.every((record) => record.production_eligible === false));
  assert.ok(corpus.records.every((record) => !("source_ids" in record) && !("source_record" in record) && !("provenance" in record)));
  assert.ok(corpus.records.every((record) => !/(?:SRC-\d+|batch\d+provenance|provenance registry|Evidence keys:|source_ids:)/i.test(`${record.title}\n${record.summary}\n${record.body}\n${record.display_body}`)));
});

test("the UI has all script-referenced controls and uses only the local bundled runtime", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const match of `${app}\n${main}`.matchAll(/(?:byId\(|querySelector\()\s*["']#?([a-z][a-z0-9-]+)["']/g)) {
    assert.ok(ids.has(match[1]), `missing UI control #${match[1]}`);
  }
  assert.match(html, /auth-mode-create/);
  assert.match(html, /dog-select/);
  assert.match(html, /experience/);
  assert.match(html, /app\.bundle\.js/);
  assert.match(main, /createFirebaseRuntime/);
  assert.match(main, /createApp\(corpus, runtime \?\? \{\}\)/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.match(html, /Local review/);
});

test("retained 47-case regression set meets or exceeds the recorded retrieval baseline", () => {
  const relevant = benchmark.cases.filter((item) => item.relevant?.length);
  const top1 = relevant.filter((item) => index.search(item.query, 1).some((hit) => item.relevant.includes(hit.record.id))).length;
  const top3 = relevant.filter((item) => index.search(item.query, 3).some((hit) => item.relevant.includes(hit.record.id))).length;
  const frozen = relevant.filter((item) => item.suite === "frozen_original_16");
  const frozenTop3 = frozen.filter((item) => index.search(item.query, 3).some((hit) => item.relevant.includes(hit.record.id))).length;
  assert.equal(relevant.length, 46);
  assert.equal(frozen.length, 16);
  assert.ok(top1 >= 43, `top-1 coverage ${top1}/${relevant.length} fell below 43`);
  assert.equal(top3, 46, `top-3 coverage ${top3}/${relevant.length}`);
  assert.equal(frozenTop3, 16, `frozen top-3 coverage ${frozenTop3}/${frozen.length}`);
});

test("home skill starters produce their foundational lesson rather than a later progression", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const starters = [...html.matchAll(/<button\b[^>]*class="[^"]*\bstarter-card\b[^"]*"[^>]*data-question="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
  const expected = new Map([
    ["Name response", "PRT-000112"],
    ["Hand target", "PRT-000114"],
    ["Settle on a mat", "PRT-000106"],
  ]);
  assert.equal(starters.length, expected.size);
  for (const [, query, content] of starters) {
    const label = content.match(/<strong>([^<]+)<\/strong>/)?.[1];
    assert.ok(expected.has(label), `unexpected starter: ${label}`);
    const hits = index.search(query, 3);
    const answer = buildAnswer({ query, records: corpus.records, hits, profile: null });
    assert.equal(answer.kind, "draft-plan", label);
    assert.deepEqual(answer.citations, [expected.get(label)], label);
    expected.delete(label);
  }
  assert.equal(expected.size, 0);
});

test("out-of-domain requests abstain with no invented evidence", () => {
  for (const query of ["Can this library teach my dog to translate French poetry?", "Explain current mortgage rates in Nevada.", "What is a reliable source for quantum computing?"]) {
    const hits = index.search(query, 3);
    const answer = buildAnswer({ query, records: corpus.records, hits, profile: null });
    assert.equal(hits.length, 0, query);
    assert.equal(answer.kind, "no-match");
    assert.deepEqual(answer.citations, []);
  }
});

test("a selected training source keeps its exact lesson and retains safety referrals", () => {
  const protocols = corpus.records.filter(record => record.type === "protocol");
  assert.equal(protocols.length, 45);
  let safetyCount = 0;
  for (const record of protocols) {
    const query = `How can I begin ${record.title.toLowerCase()}?`;
    const hits = index.search(query, 3);
    const context = { query, records: corpus.records, hits, profile: null };
    const answer = buildSourceAnswer({ record, ...context });
    if (classifySafety(query)) {
      safetyCount += 1;
      assert.equal(answer.kind, "safety", record.id);
      assert.deepEqual(answer, buildAnswer(context), record.id);
    } else {
      assert.equal(answer.kind, "draft-plan", record.id);
      assert.deepEqual(answer.citations, [record.id], record.id);
      assert.equal(answer.title, record.title, record.id);
    }
  }
  // Voluntary muzzle acclimation is a lesson; 'muzzle a dog' remains safety-routed.
  assert.equal(safetyCount, 1);
});

test("owner marker meanings and positional duration are exact and independent of search rank", () => {
  const query = "What is the difference between YES, GOOD, NO, NOPE, OKAY and position hold?";
  const answer = buildAnswer({ query, records: corpus.records, hits: [], profile: null });
  assert.equal(answer.kind, "owner-contract");
  assert.deepEqual(answer.citations, ["SCA-MARKERS-001"]);
  assert.deepEqual(answer.sections.slice(0, 5).map((section) => section.heading), OWNER_MARKERS.map((item) => item.cue));
  assert.deepEqual(answer.sections.slice(0, 5).map((section) => section.text), OWNER_MARKERS.map((item) => item.meaning));
  assert.equal(answer.sections.at(-1).text, OWNER_POSITION_RULE);
});

test("name-response plan cites the actual draft and follows a short continuation", () => {
  const record = corpus.records.find((item) => item.id === "PRT-000112");
  const firstQuery = "How do I start name response for my dog?";
  const firstHits = index.search(firstQuery, 3);
  const answer = buildAnswer({ query: firstQuery, records: corpus.records, hits: firstHits, profile: null });
  assert.equal(answer.kind, "draft-plan");
  assert.deepEqual(answer.citations, [record.id]);
  assert.ok(answer.sections.some((item) => /voluntary head turn/i.test(item.text)));
  const followup = buildAnswer({ query: "And the target?", records: corpus.records, hits: [], profile: null, previousQuery: firstQuery });
  assert.deepEqual(followup.citations, [record.id]);
  assert.ok(followup.sections.some((item) => item.heading === "Proposed success checkpoint"));
});

test("safety paths refer to the matching reviewed guidance and avoid diagnosis", () => {
  const cases = [
    ["dog collapsed and is having trouble breathing", "NUT-001", "urgent"],
    ["dog ate sugar-free gum with xylitol", "NUT-015", "urgent"],
    ["what vitamin dose should I give", "NUT-012", "health"],
    ["should I start a food elimination trial for itching", "NUT-014", "health"]
  ];
  for (const [query, expectedId, expectedKind] of cases) {
    assert.equal(classifySafety(query)?.kind, expectedKind, query);
    const hits = index.search(query, 3);
    assert.equal(hits[0]?.record.id, expectedId, query);
    const answer = buildAnswer({ query, records: corpus.records, hits, profile: null });
    assert.equal(answer.kind, "safety");
    assert.deepEqual(answer.citations, [expectedId]);
    assert.equal(answer.note, "No diagnosis or training plan was generated.");
  }
});

test("profile facts only repeat information explicitly entered", () => {
  const profile = { name: "Milo", age: "adult", breed: "mixed breed", goals: "settle on a mat", setting: "quiet room", comfort: "short sessions" };
  const answer = buildAnswer({ query: "What goal is in the selected dog profile?", records: corpus.records, hits: [], profile });
  assert.equal(answer.kind, "profile");
  assert.equal(answer.sections[0].text, "settle on a mat");
  assert.deepEqual(answer.citations, []);
  const missing = buildAnswer({ query: "What is in the selected dog profile?", records: corpus.records, hits: [], profile: null });
  assert.equal(missing.sections[0].text, "There is no active dog profile to read.");
});

test("dog profiles are scoped locally by account identity and can be changed or removed", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const local = upsertProfile([], { id: "local-1", name: "Milo", goals: "mat" });
  const account = upsertProfile([], { id: "account-1", name: "Nell", goals: "recall" });
  writeProfiles(local, storage, "local-review");
  writeProfiles(account, storage, "uid-test-user");
  assert.equal(readProfiles(storage, "local-review")[0].name, "Milo");
  assert.equal(readProfiles(storage, "uid-test-user")[0].name, "Nell");
  assert.notEqual(profileStorageKey("local-review"), profileStorageKey("uid-test-user"));
  const updated = upsertProfile(local, { ...local[0], goals: "settle" });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].goals, "settle");
  assert.deepEqual(deleteProfile(updated, "local-1"), []);
});

test("Firebase Auth configuration stays disabled by default and rejects non-loopback emulator URLs", () => {
  assert.equal(authConfigured({}), false);
  assert.match(authConfigStatus({}, "local-review").message, /disabled/i);
  const config = { apiKey: "public-web-key", authDomain: "test.firebaseapp.com", projectId: "test-project" };
  assert.equal(authConfigured(config, "local-review"), false);
  assert.equal(authConfigured(config, "authenticated"), true);
  assert.equal(authConfigured({ apiKey: "k", projectId: "p", authEmulatorUrl: "http://127.0.0.1:9099" }, "emulator"), true);
  assert.equal(authConfigured({ apiKey: "k", projectId: "p", authEmulatorUrl: "http://192.168.1.9:9099" }, "emulator"), false);
  assert.equal(authConfigured({ apiKey: "k", projectId: "p", authEmulatorUrl: "https://localhost:9099" }, "emulator"), false);
});
