import { normalizeInput, prepareInput, topicHints, outsideDomain } from "./input-language.js";

const STOP_WORDS = new Set((
  "a an and are as at be but by can could did do does dog dogs for from had has have help how i if in into is it its later library lesson lessons make me meant my need of on only or our please repeat routine should so than that the their them then these they this those to teach teaches teaching train trained training tutor up us was we were what when where which who why with would you your one again another explain current rates rate today reliable source information"
).split(" "));
for (const word of "he she him her they them want wants show tell getting gets really just would could pls please need needs know me i i'm im it's its don't doesnt doesn't has his their our with without start starting begin teach learning".split(" ")) STOP_WORDS.add(word);
for (const word of "s m re ve ll d t isn wasn aren couldn wouldn shouldn doesn didn hasn haven won don am".split(" ")) STOP_WORDS.add(word);
const GENERIC_ANCHORS = new Set("build begin teach comfortable safe voluntary practice training canine care general record guide step change routine choice support individual plan question foundation core cue sca prt edu nut toward first second preparation before without versus optional few easy short use original proposed draft review".split(" "));

const EXPANSIONS = {
  potty: ["toilet", "house", "routine", "elimination"], housebreak: ["toilet", "house", "routine", "elimination"],
  pull: ["leash", "slack", "walking"], walk: ["leash", "slack", "walking"], leash: ["loose", "slack", "walking"], lead: ["leash", "slack", "walking"],
  mat: ["station", "place"], station: ["mat", "place"], place: ["station", "mat"],
  crate: ["safe", "space", "absence", "confinement"], kennel: ["crate", "safe", "space"],
  come: ["recall", "return"], return: ["recall", "come"], fetch: ["retrieve", "bring"], bring: ["retrieve", "fetch"],
  nail: ["paw", "cooperative", "care"], clip: ["nail", "care", "cooperative"], trim: ["nail", "care", "cooperative"],
  brush: ["grooming", "cooperative", "care"], muzzle: ["basket", "cooperative", "care"],
  weird: ["unwell", "symptom", "health"], off: ["unwell", "symptom", "health"], tummy: ["abdomen", "gastrointestinal", "emergency"],
  stomach: ["abdomen", "gastrointestinal", "emergency"], bloat: ["swollen", "abdomen", "emergency"], ingest: ["ate", "toxin", "emergency"],
  call: ["name", "response", "orient"], respond: ["response", "orient"], say: ["name", "orient"], jump: ["greeting", "visitor", "feet"],
  bark: ["quiet", "alarm"], lung: ["lunge", "reactivity", "distance", "orientation"], lunge: ["reactivity", "distance", "orientation"],
  react: ["reactivity", "distance", "orientation"], brief: ["short", "session", "practice"], pause: ["repetition", "session"],
  difficult: ["progression", "criterion", "regress", "troubleshoot"], easier: ["simplify", "regress", "criteria"],
  change: ["progress", "generalize"], scared: ["fearful", "choice", "retreat"], afraid: ["fearful", "choice", "retreat"],
  toddler: ["children", "child", "safety"], unusual: ["changed", "behavior", "health"], marker: ["yes", "good", "no", "nope", "okay", "release", "hold"]
};

export const OWNER_MARKERS = Object.freeze([
  { cue: "YES", meaning: "Releases the position and promises a treat." },
  { cue: "GOOD", meaning: "Maintains the position; reward comes later." },
  { cue: "NO", meaning: "Stops unwanted behavior." },
  { cue: "NOPE", meaning: "A distinct playful teaching retry or adjustment signal." },
  { cue: "OKAY", meaning: "A general release." }
]);

export const OWNER_POSITION_RULE = "A positional cue continues until a release or another command; a separate Stay cue is not required.";

export function stemToken(value) {
  let token = String(value ?? "");
  if (token.length > 5 && token.endsWith("ing")) {
    token = token.slice(0, -3);
    if (token.length > 2 && token.at(-1) === token.at(-2)) token = token.slice(0, -1);
    if (token.endsWith("as")) token += "e";
  } else if (token.length > 4 && token.endsWith("ied")) token = `${token.slice(0, -3)}y`;
  else if (token.length > 4 && token.endsWith("ed")) {
    token = token.slice(0, -2);
    if (token.endsWith("as")) token += "e";
  } else if (token.length > 4 && token.endsWith("ies")) token = `${token.slice(0, -3)}y`;
  else if (token.length > 5 && /(?:ches|shes|xes|zes)$/.test(token)) token = token.slice(0, -2);
  else if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) token = token.slice(0, -1);
  return token;
}

export function tokenize(text) {
  return [...normalizeInput(text).matchAll(/[a-z0-9]+/g)].map(([token]) => stemToken(token));
}

export function sourcePassage(record) {
  const source = String(record?.display_body ?? record?.body ?? "");
  if (record?.type === "protocol") return source;
  const heading = source.split("\n").find(line => /^#{1,3}\s/.test(line) && line.includes(record.id));
  return heading ? source.slice(source.indexOf(heading) + heading.length).trim() : source;
}

function addWeightedTokens(target, text, weight) {
  for (const token of tokenize(text)) target.set(token, (target.get(token) ?? 0) + weight);
}

function buildIndex(records) {
  let totalLength = 0;
  const df = new Map();
  const docs = records.map((record) => {
    const tf = new Map();
    addWeightedTokens(tf, sourcePassage(record), 1);
    addWeightedTokens(tf, record.summary, 2.5);
    addWeightedTokens(tf, record.title, 4);
    addWeightedTokens(tf, (record.topics ?? []).join(" "), 3);
    addWeightedTokens(tf, (record.aliases ?? []).join(" "), 3);
    const terms = new Set(tf.keys());
    for (const term of terms) df.set(term, (df.get(term) ?? 0) + 1);
    const length = tokenize(sourcePassage(record)).length;
    totalLength += length;
    const anchors = new Set(tokenize([record.title, ...(record.aliases ?? []), ...(record.topics ?? [])].join(" ")).filter(term => !STOP_WORDS.has(term) && !GENERIC_ANCHORS.has(term) && !/^\d+$/.test(term)));
    return { record, tf, length, anchors };
  });
  return { docs, df, averageLength: Math.max(1, totalLength / Math.max(1, records.length)) };
}

function includesAny(text, terms) {
  return terms.some(term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

export function classifySafety(query) {
  const q = prepareInput(query);
  const emergency = ["collapse", "can't breathe", "cannot breathe", "trouble breathing", "difficulty breathing", "seizure", "repeated vomiting", "vomiting repeatedly", "dry retch", "unproductive retch", "swollen abdomen", "bloated abdomen", "painful swollen", "bloat", "poison", "toxin", "xylitol", "grape ingestion", "ate chocolate", "overdose"];
  emergency.push("collapsed", "collapses", "collapsing", "seizures", "poisoning", "poisoned", "toxins", "bloated", "bloating", "cant breath", "can't breath", "cannot breath", "can not breathe", "not breathing", "stopped breathing", "unable to breathe", "breathing trouble", "hard time breathing", "struggling to breathe", "retching", "keeps vomiting", "keeps throwing up", "throwing up repeatedly", "ate sugar free gum", "eaten sugar free gum", "swallowed sugar free gum");
  const urgentWording = /\b(?:isn't|ain't|not|no longer|can't|cannot|can not|unable to|not able to)\s+breath(?:e|ing)?\b|\bstruggling (?:for breath|to breath(?:e)?)\b/.test(q)
    || /\b(?:ate|eaten|ingested|swallowed|consumed)\b.{0,45}\b(?:chocolate|xylitol|sugar free(?: chewing)? gum)\b/.test(q);
  if (urgentWording || includesAny(q, emergency)) return { kind: "urgent", text: "The signs described may be urgent. Contact an emergency veterinary clinic now; do not wait for a training answer. Do not induce vomiting or give home treatment unless a veterinarian directs you. If it will not delay care, note what happened, when it began, and any substance or amount involved." };
  const health = ["seems off", "acting weird", "acting unusual", "acting different", "not themselves", "unwell", "symptom", "tummy", "stomach", "vomit", "throwing up", "diarrhea", "bloody stool", "blood in", "not eating", "won't eat", "loss of appetite", "lethargic", "weak", "limping", "pain", "injury", "itching", "cough", "sneeze", "discharge", "medication", "dose", "dosage", "sick", "illness", "fever", "swollen", "upset stomach"];
  health.push("symptoms", "vomiting", "vomited", "painful", "weakness", "injured", "injuries", "coughing", "sneezing", "medications", "medicine", "medicines", "meds", "doses", "dosages", "dosing", "will not eat");
  if (includesAny(q, health)) return { kind: "health", text: "I can't assess symptoms or medication questions from this draft library. Please contact your veterinarian, especially if the change is sudden, worsening, painful, or affects eating, breathing, movement, or responsiveness. What exact signs are you seeing and when did they start? Collapse, breathing difficulty, seizure, severe or repeated vomiting, a painful swollen abdomen, or possible toxin ingestion needs emergency veterinary help now." };
  const behavior = ["bite", "bitten", "biting", "aggression", "aggressive", "growl", "growling", "snap", "snapping", "resource guard", "dog fight", "attack", "child and dog", "unsafe handling", "restrain", "muzzle a"];
  behavior.push("bit", "bites", "snapped", "snaps", "growled", "growls", "attacked", "attacks", "attacking", "fighting", "resource guarding");
  if (includesAny(q.replace(/\b(?:a|little|tiny) bit\b/g, "a little"), behavior)) return { kind: "behavior", text: "This may involve injury or safety risk. Keep people and animals separated with distance or a barrier when safe; do not punish, corner, grab, or force handling. Contact your veterinarian for health or pain concerns and a qualified behavior professional for an individualized plan. If anyone is in immediate danger, move away and contact local emergency help." };
  return null;
}

export function isMarkerContractQuery(query) {
  const q = prepareInput(query);
  const markers = [...q.matchAll(/\b(?:yes|good|no|nope|okay)\b/g)].length;
  const asksAboutMarkerRules = /\b(?:markers?|meanings?|mean|means|define|definitions|semantics|release|positional|hold|holding|stay|position|continue|continues|difference|playful|retry)\b/.test(q);
  return (markers >= 2 && /\b(?:same|different|correct|corrections?)\b/.test(q))
    || (markers > 0 && (/\b(?:cue|cues|marker|markers|signal|signals|meaning|mean|means|define|definitions|semantics|release|continuation|holding|continue|continues|difference|versus|vs|playful|retry)\b/.test(q)
    || /\b(?:say|use)\s+(?:the\s+)?(?:yes|good|no|nope|okay)(?:\s+(?:cue|marker|signal))?$/.test(q)))
    || (asksAboutMarkerRules && /\b(?:marker|markers|signal|signals)\b/.test(q))
    || (/\b(?:position|positional|holding|hold|stay)\b/.test(q) && /\b(?:until|release|releasing|continue|continues)\b/.test(q));
}

function queryIntent(query) {
  const normalized = tokenize(query);
  return {
    marker: isMarkerContractQuery(query),
    name: normalized.includes("name") && normalized.some((term) => ["response", "respond", "orient", "call"].includes(term)),
    station: normalized.some((term) => ["station", "mat"].includes(term)) && normalized.some((term) => ["entry", "duration", "hold"].includes(term)),
    session: (normalized.includes("measurable") || normalized.includes("measurably")) && normalized.some((term) => ["target", "practice", "session"].includes(term)),
    leashReactivity: normalized.includes("leash") && normalized.some((term) => ["lung", "lunge", "react", "reactivity"].includes(term))
  };
}

export function createSearchIndex(records) {
  const { docs, df, averageLength } = buildIndex(records);
  return Object.freeze({
    search(query, take = 5) {
      query = prepareInput(query);
      const safety = classifySafety(query);
      if (safety?.kind === "urgent" || safety?.kind === "health") {
        const routeId = /xylitol|sugar free(?: chewing)? gum|possible toxin/i.test(query) ? "NUT-015"
          : /food allerg|elimination trial|adverse food/i.test(query) ? "NUT-014"
            : /supplement|vitamin|dose|dosage/i.test(query) ? "NUT-012" : "NUT-001";
        const route = docs.find(doc => doc.record.id === routeId)?.record;
        return route ? [{ record: route, score: 0, coverage: 0, matchTerms: ["safety referral"], priority: -10, safetyRouted: true }] : [];
      }
      if (!safety && outsideDomain(query)) return [];
      const requestedIds = [...query.matchAll(/\b(prt|edu|nut)\s*0*(\d+)\b/g)];
      if (requestedIds.length) {
        return requestedIds.flatMap(([, prefix, digits]) => {
          const record = docs.find(doc => doc.record.id.toLowerCase().replace(/-0*/, "-") === `${prefix}-${Number(digits)}`)?.record;
          return record ? [{ record, score: 100, coverage: 1, matchTerms: [record.id], priority: -1 }] : [];
        }).slice(0, take);
      }
      const hints = topicHints(query);
      const hasDogContext = /\b(?:dog|dogs|puppy|puppies|canine|pooch|training|leash|kennel|crate|handler)\b/.test(query);
      const baseTerms = new Set();
      const queryWeights = new Map();
      const variantsByBase = new Map();
      for (const [raw] of String(query ?? "").toLowerCase().matchAll(/[a-z0-9]+/g)) {
        const token = stemToken(raw);
        if (STOP_WORDS.has(raw) || STOP_WORDS.has(token)) continue;
        baseTerms.add(token);
        if (!variantsByBase.has(token)) variantsByBase.set(token, new Set());
        variantsByBase.get(token).add(token);
        queryWeights.set(token, 1);
        for (const expansion of (!hasDogContext && token === "react" ? [] : EXPANSIONS[token] ?? EXPANSIONS[raw] ?? [])) {
          const expanded = stemToken(expansion);
          variantsByBase.get(token).add(expanded);
          queryWeights.set(expanded, Math.max(queryWeights.get(expanded) ?? 0, 0.55));
        }
      }
      if (baseTerms.size === 0) return [];

      const results = [];
      const queryPhrase = tokenize(query).filter((token) => !STOP_WORDS.has(token)).join(" ");
      for (const doc of docs) {
        let score = 0;
        const matched = new Set();
        const matchedQueryTerms = [];
        for (const [term, weight] of queryWeights) {
          const frequency = doc.tf.get(term) ?? 0;
          const documentFrequency = df.get(term) ?? 0;
          if (frequency <= 0 || documentFrequency <= 0) continue;
          const idf = Math.log(1 + (docs.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
          score += weight * idf * (frequency * 2.5) / (frequency + 1.5 * (0.25 + 0.75 * doc.length / averageLength));
          matched.add(term);
        }
        let matchedGroups = 0;
        for (const [base, variants] of variantsByBase) {
          if ([...variants].some((term) => matched.has(term))) {
            matchedGroups += 1;
            matchedQueryTerms.push(base);
          }
        }
        const coverage = matchedGroups / Math.max(1, baseTerms.size);
        const titlePhrase = tokenize(doc.record.title).filter((token) => !STOP_WORDS.has(token)).join(" ");
        if (titlePhrase.split(/\s+/).length >= 2 && queryPhrase.includes(titlePhrase)) score += 1.5;
        const unfamiliar = [...baseTerms].filter(term => !df.has(term) && !EXPANSIONS[term]).length;
        const hinted = hints.includes(doc.record.id) && (hasDogContext || unfamiliar <= baseTerms.size * 0.25);
        const anchorMatch = [...matched].some(term => doc.anchors.has(term));
        if (!hinted && (!anchorMatch || score <= 0 || matchedGroups === 0 || coverage < (hasDogContext ? 0.2 : 0.6) || score < 0.15)) continue;
        if (hinted) score += 20 - hints.indexOf(doc.record.id) * 0.1;
        results.push({ record: doc.record, score: Math.round(score * 1e6) / 1e6, coverage, matchTerms: matchedQueryTerms.slice(0, 5), priority: 10 });
      }

      const intent = queryIntent(query);
      for (const hit of results) {
        if (intent.marker && hit.record.id === "PRT-000102") hit.priority = 0;
        else if (intent.name && hit.record.id === "PRT-000112") hit.priority = 0;
        else if (intent.station && hit.record.id === "PRT-000106") hit.priority = 0;
        else if (intent.session && hit.record.id === "PRT-000103") hit.priority = 0;
        else if (intent.leashReactivity && hit.record.id === "PRT-000306") hit.priority = 0;
      }

      if (!safety && intent.marker && !results.some((hit) => hit.record.id === "PRT-000102")) {
        const route = docs.find((doc) => doc.record.id === "PRT-000102")?.record;
        if (route) results.push({ record: route, score: 0, coverage: 0, matchTerms: ["marker reference"], priority: 0 });
      }
      const unique = [];
      const ids = new Set();
      const titles = new Set();
      for (const hit of results.sort((a, b) => a.priority - b.priority || b.score - a.score || a.record.id.localeCompare(b.record.id))) {
        const titleKey = tokenize(hit.record.title).join(" ");
        if (ids.has(hit.record.id) || (titleKey && titles.has(titleKey))) continue;
        ids.add(hit.record.id);
        if (titleKey) titles.add(titleKey);
        unique.push(hit);
        if (unique.length >= take) break;
      }
      return unique;
    }
  });
}

export function parseLabeledFields(text) {
  const value = String(text ?? "");
  const headings = [...value.matchAll(/^([a-z_]+):(?:[ \t]*(.*))?$/gm)];
  const fields = {};
  for (let i = 0; i < headings.length; i += 1) {
    const match = headings[i];
    const start = match.index + match[0].length;
    const end = headings[i + 1]?.index ?? value.length;
    const content = [match[2] ?? "", value.slice(start, end)].filter(Boolean).join("\n").trim();
    if (match[1] === "step_id" || match[1] === "handler_action" || match[1] === "observe") continue;
    fields[match[1]] = content;
  }
  return fields;
}

export function extractSteps(text) {
  const value = String(text ?? "");
  const starts = [...value.matchAll(/^step_id:\s*(.+)$/gm)];
  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? value.length;
    const block = value.slice(start.index, end);
    const get = (key) => block.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
    return { id: start[1].trim(), action: get("handler_action"), observe: get("observe"), stop: get("stop_if"), advance: get("advance_if"), regress: get("regress_if") };
  }).filter((step) => step.action);
}

export function resolveQuery(query, previousQuery = "") {
  const current = prepareInput(query);
  if (!previousQuery || outsideDomain(current) || /^(?:new question|different topic|different dog)\b/.test(current)) return current;
  const previous = prepareInput(previousQuery);
  if (classifySafety(previous)) return `${previous} ${current}`;
  const followup = /^(?:and\b|what about\b|how about\b|then\b|there\b|in that case\b|what next\b)/.test(current)
    || /^(?:what|how|when|can|should).{0,40}\b(?:next|again|that|this|more|long|target|criterion|criteria|reward|easier|harder)\b/.test(current);
  return followup && !topicHints(current).length && !outsideDomain(current) ? `${previous} ${current}` : current;
}

function isProfileFactQuestion(query) {
  const q = prepareInput(query);
  const personal = /\b(?:profile|saved dog|selected dog|my dog|our dog)\b/.test(q)
    || /\b(?:his|her|their) (?:name|breed|age|goals?|routine|comfort)\b/.test(q);
  const storedContext = /\b(?:profile|saved dog|selected dog|saved|entered|recorded)\b/.test(q);
  const naturalFact = /\b(?:my|our) dog(?:'s)? (?:name|age|breed|goals?|routine|comfort)\b|\b(?:his|her|their) (?:name|age|breed|goals?|routine|comfort)\b|\bwhat (?:breed|age|name) is (?:my|our) dog\b|\bhow old is (?:my|our) dog\b/.test(q)
    && !/\b(?:name response|respond|responding|when i|call)\b/.test(q);
  const readRequest = /\b(?:what|which|exact|saved|entered|written|recorded|show|list|read|tell)\b/.test(q) || /\bhow old is\b/.test(q);
  return personal && (storedContext || naturalFact) && readRequest && !/\b(?:plan|practice|start|begin|train|teach|steps|should)\b/.test(q);
}

export function answerProfileFact(query, profile) {
  if (!isProfileFactQuestion(query)) return null;
  if (!profile) return { kind: "profile", title: "No dog selected", sections: [{ heading: "Profile", text: "There is no active dog profile to read." }], citations: [] };
  const q = tokenize(prepareInput(query)).join(" ");
  const fields = [
    ["goal", "Training goals", profile.goals], ["skill", "Training goals", profile.goals],
    ["breed", "Breed or mix", profile.breed], ["mix", "Breed or mix", profile.breed],
    ["age", "Age or life stage", profile.age], ["life stage", "Age or life stage", profile.age],
    ["routine", "Routine or setting", profile.setting], ["setting", "Routine or setting", profile.setting], ["environment", "Routine or setting", profile.setting],
    ["comfort", "Comfort preferences", profile.comfort], ["preference", "Comfort preferences", profile.comfort], ["name", "Name", profile.name]
  ];
  const selected = fields.find(([needle]) => includesAny(q, [tokenize(needle).join(" ")]))
    ?? (/\bhow old\b/.test(q) ? fields.find(([needle]) => needle === "age") : null);
  if (!selected) return { kind: "profile", title: profile.name, sections: [{ heading: "Profile facts", text: "Ask for the saved name, age, breed or mix, training goal, routine, or comfort preference. No other dog facts are inferred." }], citations: [] };
  return { kind: "profile", title: profile.name, sections: [{ heading: selected[1], text: selected[2]?.trim() || `No value is entered for ${selected[1]}.` }], note: "User-entered profile data · not library evidence", citations: [] };
}

function nameResponseAnswer(query, records) {
  const q = String(query).toLowerCase();
  const intent = queryIntent(query);
  const asksTarget = /\b(initial|exact|success|criterion|criteria|target|threshold)\b/.test(q);
  const asksSteps = /\b(first|steps|actions|begin|start)\b/.test(q);
  const asksGoal = !/\b(why|if|miss|missed|doesn't|does not|not responding|scared|afraid|changed|different|problem|worry)\b/.test(q) && /\b(what|goal|purpose|teach|lesson|meaning|means|should)\b/.test(q);
  if (!intent.name || (!asksTarget && !asksSteps && !asksGoal)) return null;
  const record = records.find((item) => item.id === "PRT-000112");
  if (!record) return null;
  const summary = String(record.summary ?? "").split("Proposed target:");
  const goal = summary[0]?.trim().replace(/[.\s]+$/, "");
  if (!goal) return null;
  const fields = parseLabeledFields(record.display_body);
  const steps = extractSteps(record.display_body);
  const sections = [{ heading: "Goal", text: `${goal}.` }];
  if (asksSteps) sections.push({ heading: "First actions from the draft", text: steps.slice(0, 3).map((step, index) => `${index + 1}. ${step.action}`).join("\n") || "This record does not specify a step." });
  if (asksTarget && summary.length > 1) sections.push({ heading: "Proposed success checkpoint", text: summary[1].trim() });
  if (fields.setup && asksSteps) sections.push({ heading: "Setup", text: fields.setup });
  return { kind: "draft-plan", title: record.title, sections, note: "Unapproved draft · not a validated standard or guarantee", citations: [record.id], records: [record] };
}

export function draftPlanFor(record, question = "") {
  if (!record) return null;
  if (record.type !== "protocol") {
    const passage = sourcePassage(record);
    const paragraphs = passage.split(/\n\s*\n/).map(block => block.trim())
      .filter(block => block && !/^#{1,6}\s|^<a\b/.test(block));
    const sections = paragraphs.slice(0, 3).map((block, index) => ({
      heading: index === 0 ? "From this guide" : "More from the guide",
      text: block.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1"),
    }));
    if (record.summary) sections.push({ heading: "When to get help", text: record.summary });
    return { kind: "guide", title: record.title, sections, note: "Exact passages from this review draft. Read the full guide for context and limits; this is general education, not an individual care plan.", citations: [record.id], records: [record] };
  }
  const fields = parseLabeledFields(record.display_body);
  const steps = extractSteps(record.display_body);
  const sections = [];
  const goal = fields.goal || record.summary;
  if (goal) sections.push({ heading: "Goal in this draft", text: goal });
  if (fields.setup) sections.push({ heading: "Setup", text: fields.setup });
  if (steps.length) sections.push({ heading: "First actions in source order", text: steps.slice(0, 3).map((step, index) => `${index + 1}. ${step.action}`).join("\n") });
  const observation = steps[0]?.observe || fields.baseline_measurement;
  if (observation) sections.push({ heading: "What to observe", text: observation });
  const advance = steps[0]?.advance || fields.progression;
  if (advance) sections.push({ heading: "When the draft says to progress", text: advance });
  if (/\b(?:easier|simplify|struggling|not working|miss|misses)\b/.test(question) && (steps[0]?.regress || fields.troubleshooting)) {
    sections.push({ heading: "Make it easier", text: steps[0]?.regress || fields.troubleshooting });
  }
  if (/\b(?:how long|how much time|minutes|session length|duration)\b/.test(question) && fields.dose) {
    sections.push({ heading: "Practice length in the source", text: fields.dose });
  }
  if (/\b(?:target|criterion|criteria|checkpoint|success)\b/.test(question) && fields.observable_target) {
    sections.push({ heading: "Proposed success checkpoint", text: fields.observable_target });
  }
  const stop = steps[0]?.stop || fields.welfare_checks;
  if (stop) sections.push({ heading: "Stop or get help", text: stop });
  if (!sections.some((section) => section.heading.startsWith("First actions"))) sections.push({ heading: "Teaching steps", text: "This record does not specify a step-by-step teaching sequence. Review the exact passage before acting." });
  return { kind: "draft-plan", title: record.title, sections, note: "Only fields present in this unapproved draft are shown. No facts were added by a language model.", citations: [record.id], records: [record] };
}

export function buildAnswer({ query, records, hits, profile, previousQuery = "" }) {
  query = prepareInput(query);
  const resolved = resolveQuery(query, previousQuery);
  const safety = classifySafety(resolved);
  if (safety) {
    const safeHits = hits.some(hit => hit.safetyRouted) ? hits : createSearchIndex(records).search(resolved, 3);
    return { kind: "safety", title: safety.kind === "urgent" ? "Urgent veterinary guidance" : safety.kind === "health" ? "Health question" : "Safety first", message: safety.text, note: "No diagnosis or training plan was generated.", safetyContext: resolved, citations: safeHits.filter(hit => hit.safetyRouted).map(hit => hit.record.id), records: safeHits.map(hit => hit.record) };
  }
  const profileAnswer = answerProfileFact(query, profile);
  if (profileAnswer) return profileAnswer;
  if (outsideDomain(resolved)) return { kind: "no-match", title: "No supporting lesson was found", message: "This question is outside the training and care topics supported by this library.", safetyContext: classifySafety(previousQuery) ? previousQuery : undefined, citations: [], records: [] };
  if (isMarkerContractQuery(resolved)) return { kind: "owner-contract", title: "Owner-confirmed cue rules", sections: [...OWNER_MARKERS.map((item) => ({ heading: item.cue, text: item.meaning })), { heading: "Positional cues", text: OWNER_POSITION_RULE }], note: "These rules come from the owner-confirmed contract, not from retrieved draft lessons.", citations: ["SCA-MARKERS-001"], records: [] };
  const nameAnswer = nameResponseAnswer(resolved, records);
  if (nameAnswer) return nameAnswer;
  const resolvedHits = resolved !== query ? createSearchIndex(records).search(resolved, 3) : hits;
  if (!resolvedHits.length) return { kind: "no-match", title: "No supporting lesson was found", message: "I did not find a useful match in the packaged review library. Try a lesson title or a narrower training term; I won't invent a lesson or citation.", citations: [], records: [] };
  return draftPlanFor(resolvedHits[0].record, query);
}
