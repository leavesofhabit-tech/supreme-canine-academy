import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeInput, prepareInput } from "../src/input-language.js";
import {
  buildAnswer, classifySafety, createSearchIndex, draftPlanFor, resolveQuery,
  sourcePassage, parseLabeledFields, extractSteps, OWNER_MARKERS, OWNER_POSITION_RULE,
} from "../src/retrieval.js";

const { records } = JSON.parse(await readFile(new URL("../data/knowledge.json", import.meta.url), "utf8"));
const index = createSearchIndex(records);
const recordById = new Map(records.map(record => [record.id, record]));

// Follow the client contract: resolve a continuation before searching, while
// passing the actual new question to answer/profile/owner-rule handling.
function answerFor(query, previousQuery = "", profile = null) {
  const hits = index.search(resolveQuery(query, previousQuery), 3);
  return buildAnswer({ query, records, hits, profile, previousQuery });
}

test("input normalization handles Unicode punctuation, spacing, accents, and absent values", () => {
  assert.equal(normalizeInput("  DOG’S\tNAME — RéSponse!  "), "dog's name response");
  assert.equal(normalizeInput("He can’t breathe; she wont eat."), "he can't breathe she won't eat");
  assert.equal(normalizeInput("ＤＯＧ name"), "dog name");
  assert.equal(normalizeInput(null), "");
  assert.equal(normalizeInput(undefined), "");
  assert.equal(normalizeInput(42), "42");
});

test("curated input correction repairs known variants without inventing short-word meanings", () => {
  assert.equal(prepareInput("Naem responce and tuch on a leesh"), "name response and touch on a leash");
  assert.equal(prepareInput("Settel on a matt"), "settle on a mat");
  assert.equal(prepareInput("Matt has a bank account and a bit of paint"), "matt has a bank account and a bit of paint");
  assert.equal(prepareInput("x".repeat(5000)).length, 1200);
});

test("urgent input variants produce referral answers instead of training plans", async (t) => {
  const queries = [
    "My dog can’t breathe", "My dog cant breathe", "My dog can't breath",
    "My dog is not breathing", "My dog isnt breathing", "My dog isn't breathing",
    "My dog isn’t breathing", "He stopped breathing",
    "My dog colapsed", "He had a siezure", "My dog ate xylatol gum",
    "My dog keeps vommiting", "My dog is struggling to breathe",
  ];
  for (const query of queries) {
    await t.test(query, () => {
      assert.equal(classifySafety(query)?.kind, "urgent");
      const answer = answerFor(query);
      assert.equal(answer.kind, "safety");
      assert.match(answer.title, /urgent/i);
      assert.match(answer.message, /emergency veterinary/i);
      assert.equal((answer.sections ?? []).length, 0);
      assert.ok(answer.citations.every(id => id.startsWith("NUT-")));
    });
  }
});

test("common health spellings keep the existing health-referral boundary", async (t) => {
  for (const query of ["My dog won’t eat", "My dog wont eat", "My dog has diarhea", "My dog has painful paws", "My dog has weakness"]) {
    await t.test(query, () => {
      assert.equal(classifySafety(query)?.kind, "health");
      const answer = answerFor(query);
      assert.equal(answer.kind, "safety");
      assert.equal(answer.title, "Health question");
      assert.equal((answer.sections ?? []).length, 0);
    });
  }
});

test("past-tense bites are recognized without treating the ordinary a-bit idiom as injury", () => {
  assert.equal(classifySafety("My dog bit a child")?.kind, "behavior");
  assert.equal(classifySafety("A dog bit me yesterday")?.kind, "behavior");
  assert.equal(classifySafety("He bit me a bit ago")?.kind, "behavior");
  assert.equal(answerFor("My dog bit a visitor").kind, "safety");
  assert.equal(classifySafety("My puppy is a bit distracted"), null);
  assert.equal(classifySafety("Could I make this training a bit easier?"), null);
});

test("safety takes priority over unrelated vocabulary and supplied training hits", () => {
  for (const query of [
    "My dog cant breathe while I work on JavaScript",
    "My dog colapsed beside my computer",
    "My dog has diarrhea and I need a mortgage",
    "My dog bit me near the bank",
  ]) {
    const answer = buildAnswer({
      query, records, hits: index.search("How do I teach sit?", 3), profile: null,
    });
    assert.equal(answer.kind, "safety", query);
    assert.equal((answer.sections ?? []).length, 0, query);
  }
});

test("similar substrings in ordinary words do not become health symptoms", () => {
  for (const query of [
    "How do I paint a dog portrait?", "How do I tweak my training routine?",
    "How should I practice with my dog in Spain?", "Can I take a snapshot of the session?",
  ]) assert.equal(classifySafety(query), null, query);
});

test("plain training spelling variants find their foundational source", async (t) => {
  const cases = [
    ["How do I start naem responce?", "PRT-000112"],
    ["How do I teach a tuch hand target?", "PRT-000114"],
    ["My dog keeps pulling on the leesh", "PRT-000109"],
    ["How do I begin recal?", "PRT-000110"],
    ["How do I settel on a matt?", "PRT-000106"],
    ["How do I introduce a harnes?", "PRT-000203"],
    ["How do I retreive a ball?", "PRT-000401"],
    ["How do I begin toilettraining a pupy?", "PRT-000108"],
  ];
  for (const [query, id] of cases) {
    await t.test(query, () => {
      const answer = answerFor(query);
      assert.equal(answer.kind, "draft-plan");
      assert.deepEqual(answer.citations, [id]);
    });
  }
});

test("unrelated and mixed-domain requests abstain despite ambiguous skill words", async (t) => {
  for (const query of [
    "How do I settle a mortgage?", "How can I swap cryptocurrency?",
    "Can you recall Bitcoin prices?", "My React.js app is down",
    "How do I use React.js state?", "Can you recall the weather report?",
    "Will it rain tomorrow?", "What is the best place to buy pizza?",
    "How do I make pizza dough?",
  ]) {
    await t.test(query, () => {
      const hits = index.search(query, 3);
      assert.equal(hits.length, 0, "unrelated language must not select a lesson");
      const answer = buildAnswer({ query, records, hits, profile: null });
      assert.equal(answer.kind, "no-match");
      assert.deepEqual(answer.citations, []);
    });
  }
});

test("generic continuations retain the skill while explicit new skills replace it", () => {
  const previous = "How do I start name response for my dog?";
  const continuation = resolveQuery("And the target?", previous);
  assert.match(continuation, /name response/);
  const answer = answerFor("And the target?", previous);
  assert.deepEqual(answer.citations, ["PRT-000112"]);
  assert.ok(answer.sections.some(section => /success checkpoint/i.test(section.heading)));
  const handTarget = "How do I begin a hand target?";
  assert.match(resolveQuery("How can I make that easier?", handTarget), /hand target/);
  assert.deepEqual(answerFor("How can I make that easier?", handTarget).citations, ["PRT-000114"]);
  for (const [query, id] of [["nail trim", "PRT-000205"], ["down", "PRT-000105"], ["What about hand targeting?", "PRT-000114"]]) {
    assert.equal(resolveQuery(query, previous), prepareInput(query), query);
    assert.deepEqual(answerFor(query, previous).citations, [id], query);
  }
  assert.equal(resolveQuery("How do I settle a mortgage?", previous), "how do i settle a mortgage");
});

test("health and urgent context remains a referral until the user explicitly changes context", async (t) => {
  for (const previous of ["My dog cant breathe", "My dog has weakness"]) {
    for (const query of ["what next?", "sit"]) {
      await t.test(`${previous} → ${query}`, () => {
        const answer = answerFor(query, previous);
        assert.equal(answer.kind, "safety");
        assert.equal((answer.sections ?? []).length, 0);
      });
    }
    const unsupported = answerFor("How do I settle a mortgage?", previous);
    assert.equal(unsupported.kind, "no-match");
    assert.deepEqual(unsupported.citations, []);
    // An unrelated question does not claim a new emergency, nor erase the old
    // concern if the user immediately attempts to resume training afterward.
    assert.equal(unsupported.safetyContext, previous);
    assert.equal(answerFor("sit", unsupported.safetyContext).kind, "safety");
    assert.equal(answerFor("Different dog: how do I teach sit?", previous).kind, "draft-plan");
  }
});

test("explicit source codes match only existing records despite common punctuation variants", () => {
  for (const [query, id] of [["PRT-000115", "PRT-000115"], ["PRT 000116", "PRT-000116"], ["Please show PRT115", "PRT-000115"], ["NUT-002", "NUT-002"]]) {
    assert.deepEqual(answerFor(query).citations, [id], query);
  }
  assert.equal(answerFor("PRT-999999").kind, "no-match");
  assert.equal(answerFor("My dog can't breathe, show PRT115").kind, "safety");
});

test("contraction fragments and two-marker comparisons do not obscure the requested topic", () => {
  for (const query of ["What's recall?", "I'm learning recall", "I've started recall"]) {
    assert.deepEqual(answerFor(query).citations, ["PRT-000110"], query);
  }
  assert.equal(answerFor("Are NOPE and NO the same correction?").kind, "owner-contract");
  assert.equal(answerFor("How do I teach a good recall?").kind, "draft-plan");
});

test("education answers quote their specific guide rather than a shared collection preface", async (t) => {
  for (const [query, id] of [
    ["Puppy socialization exposure", "EDU-000501"],
    ["Complete and balanced food label", "NUT-002"],
    ["How do I change foods?", "NUT-008"],
    ["Water access and drinking", "NUT-009"],
  ]) {
    await t.test(id, () => {
      const record = recordById.get(id);
      const answer = answerFor(query);
      assert.equal(answer.kind, "guide");
      assert.deepEqual(answer.citations, [id]);
      assert.equal(answer.sections[0].heading, "From this guide");
      assert.ok(answer.sections[0].text.length > 50);
      const passage = sourcePassage(record).replace(/[*`]/g, "");
      assert.ok(passage.includes(answer.sections[0].text), "the excerpt must come from its cited source");
      const copy = answer.sections.map(section => section.text).join("\n");
      assert.doesNotMatch(copy, /Source identities and claim provenance|Seven modules supplement|### How to use this draft/);
      assert.ok(!answer.sections.some(section => section.heading === "Teaching steps"));
      assert.deepEqual(draftPlanFor(record).citations, [id]);
    });
  }
});

test("owner cue meanings remain exact and independent of spelling assistance", () => {
  const answer = answerFor("What do YES GOOD NO NOPE and OKAY mean for the position?");
  assert.equal(answer.kind, "owner-contract");
  assert.deepEqual(answer.citations, ["SCA-MARKERS-001"]);
  assert.deepEqual(answer.sections.slice(0, 5).map(section => section.heading), OWNER_MARKERS.map(marker => marker.cue));
  assert.deepEqual(answer.sections.slice(0, 5).map(section => section.text), OWNER_MARKERS.map(marker => marker.meaning));
  assert.equal(answer.sections.at(-1).text, OWNER_POSITION_RULE);
});

test("profile facts preserve original user-entered values and never infer missing fields", () => {
  const profile = { name: "Tuch", breed: "Naem mix", goals: "Retreive with Naem", age: "" };
  const breed = answerFor("What is the selected dog's breed?", "", profile);
  assert.equal(breed.kind, "profile");
  assert.equal(breed.sections[0].text, "Naem mix");
  assert.deepEqual(breed.citations, []);
  const name = answerFor("What is the saved dog name?", "", profile);
  assert.equal(name.sections[0].text, "Tuch");
  const age = answerFor("What is the selected dog age?", "", profile);
  assert.match(age.sections[0].text, /No value is entered/i);
});

test("natural questions read the selected dog's stored facts without hijacking a training question", async (t) => {
  const profile = { name: "Milo", breed: "Spaniel mix", age: "4 years", goals: "Calm hand targeting" };
  for (const [query, field, expected] of [
    ["What is my dog’s name?", "Name", profile.name],
    ["What breed is my dog?", "Breed or mix", profile.breed],
    ["How old is my dog?", "Age or life stage", profile.age],
    ["What are his goals?", "Training goals", profile.goals],
  ]) {
    await t.test(query, () => {
      const answer = answerFor(query, "", profile);
      assert.equal(answer.kind, "profile");
      assert.equal(answer.sections[0].heading, field);
      assert.equal(answer.sections[0].text, expected);
      assert.deepEqual(answer.citations, []);
      const absent = answerFor(query);
      assert.equal(absent.kind, "profile");
      assert.equal(absent.title, "No dog selected");
    });
  }
  const training = answerFor("What is name response for my dog?", "", profile);
  assert.equal(training.kind, "draft-plan");
  assert.deepEqual(training.citations, ["PRT-000112"]);
});

test("quoted emergency wording and inflections retain safety while little-bit language remains ordinary", async (t) => {
  for (const query of [
    '"My dog isn’t breathing"', "'My dog isn't breathing'",
    "My dog is bloated", "My dog collapses during a walk",
  ]) {
    await t.test(query, () => {
      assert.equal(classifySafety(query)?.kind, "urgent");
      const answer = answerFor(query);
      assert.equal(answer.kind, "safety");
      assert.match(answer.title, /urgent/i);
      assert.equal((answer.sections ?? []).length, 0);
    });
  }
  assert.equal(classifySafety("My puppy needs a little bit of practice"), null);
  assert.equal(classifySafety("Can I make the hand target a little bit easier?"), null);
  assert.equal(classifySafety("He bit my hand a little bit")?.kind, "behavior");
});

test("generic duration, easier, and target follow-ups reproduce the cited source fields exactly", async (t) => {
  for (const [id, previous] of [
    ["PRT-000114", "How do I begin a hand target?"],
    ["PRT-000106", "How do I start mat station entry?"],
    ["PRT-000109", "How do I start loose leash walking?"],
  ]) {
    const record = recordById.get(id);
    const fields = parseLabeledFields(record.display_body);
    const firstStep = extractSteps(record.display_body)[0];
    const requests = [
      ["How long should I practice?", "Practice length in the source", fields.dose],
      ["How can I make that easier?", "Make it easier", firstStep.regress || fields.troubleshooting],
      ["What is the target?", "Proposed success checkpoint", fields.observable_target],
    ];
    for (const [query, heading, expected] of requests) {
      await t.test(`${id}: ${query}`, () => {
        assert.ok(expected, "this source contains the field being requested");
        const answer = answerFor(query, previous);
        assert.equal(answer.kind, "draft-plan");
        assert.deepEqual(answer.citations, [id]);
        const section = answer.sections.find(section => section.heading === heading);
        assert.ok(section, `${heading} must answer the follow-up`);
        assert.equal(section.text, expected);
      });
    }
  }
});
