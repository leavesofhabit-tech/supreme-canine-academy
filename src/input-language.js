// Deliberate spelling variants keep short, unrelated words (bank, bit, etc.)
// from being silently converted into training or medical terms.
const SPELLING = Object.freeze({
  naem: "name", nmae: "name", responce: "response", respones: "response",
  tuch: "touch", touh: "touch", leesh: "leash", lesh: "leash", leashe: "leash",
  recal: "recall", recalll: "recall", setle: "settle", settel: "settle",
  coller: "collar", collor: "collar", harnes: "harness", harnass: "harness",
  retreive: "retrieve", retrive: "retrieve", retreiving: "retrieving", pawz: "paws",
  pupy: "puppy", pupppy: "puppy", puppie: "puppy", traning: "training",
  doggo: "dog", pupper: "puppy", pup: "puppy",
  trainning: "training", socialisation: "socialization", behavour: "behavior",
  behaviour: "behavior", toilettraining: "toilet training", housetraining: "house training",
  housebreaking: "house breaking", looseleash: "loose leash", cratee: "crate",
  colapsed: "collapsed", collasped: "collapsed", collapsd: "collapsed",
  siezure: "seizure", siezures: "seizures", seizue: "seizure",
  xylatol: "xylitol", xylotol: "xylitol", xilitol: "xylitol",
  vommiting: "vomiting", vomitting: "vomiting", diarhea: "diarrhea", diarrhoea: "diarrhea",
  agression: "aggression", aggresive: "aggressive", poision: "poison",
});

export function normalizeInput(value) {
  return String(value ?? "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’`´]/g, "'")
    .replace(/[^a-zA-Z0-9'\s]/g, " ")
    .toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/\bcant\b/g, "can't").replace(/\bwont\b/g, "won't").replace(/\bisnt\b/g, "isn't");
}

export function prepareInput(value) {
  const query = normalizeInput(String(value ?? "").slice(0, 1200)).replace(/\b[a-z]+\b/g, word => SPELLING[word] ?? word);
  return /\b(?:settle|station|place)\b/.test(query) ? query.replace(/\bmatt\b/g, "mat") : query;
}

// These phrases describe existing sources. They choose a source, never create
// instructions or change its contents. Safety classification always runs first.
const TOPICS = [
  ["PRT-000112", /\bname\b.*\b(?:response|respond|recogn|attention|turn|look|ignore|called|call|say)\w*\b|\b(?:respond|answer|listen|look|ignore|say|call)\w*\b.*\bname\b/],
  ["PRT-000114", /\b(?:hand target(?:ing)?|nose to hand|touch)\b/],
  ["PRT-000106", /\b(?:mat|station)\b|\b(?:settle|settling|place)\b.*\b(?:bed|spot|dog|puppy)\b/],
  ["PRT-000108", /\b(?:potty|toilet|house training|house breaking|pee|poop|peeing|pooping)\b/],
  ["PRT-000109", /\b(?:loose leash|slack (?:lead|leash)|pulling|pulls|drags?)\b/],
  ["PRT-000110", /\brecall\b|\b(?:come|coming|comes|return|back)\b.*\b(?:called|call|back|return)\b/],
  ["PRT-000111", /\b(?:crate|kennel|safe space|absence|absences|home alone|left alone)\b/],
  ["PRT-000104", /\bsit(?:ting)?\b/],
  ["PRT-000105", /\b(?:down|lie down|lay down)\b/],
  ["PRT-000115", /\bstand(?:ing)?\b/],
  ["PRT-000116", /\bheel\b/],
  ["PRT-000117", /\bleave it\b|\b(?:grab|grabs|taking|take|pick)\b.*\b(?:ground|floor)\b/],
  ["PRT-000118", /\b(?:drop|give|trade|swap|exchange)\b.*\b(?:toy|ball|object|item|back|cooperative)\b|\b(?:toy|ball)\b.*\b(?:give|drop|release)\b/],
  ["PRT-000119", /\b(?:wait|waiting|boundary)\b.*\b(?:door|doorway|gate)\b/],
  ["PRT-000120", /\boff\b.*\b(?:sofa|couch|furniture|paws|down)\b/],
  ["PRT-000121", /\b(?:transfer|new)\b.*\b(?:bed|place|mat)\b/],
  ["PRT-000201", /\bchin\b/], ["PRT-000202", /\bpaws?\b.*\b(?:present|presentation|offer|give)\w*\b/],
  ["PRT-000203", /\b(?:collar|harness)\b/], ["PRT-000204", /\b(?:brush|brushing|grooming)\b/],
  ["PRT-000205", /\b(?:nail|nails|nailcare)\b/], ["PRT-000206", /\bmuzzle\b/],
  ["PRT-000301", /\b(?:jump|jumping|jumps|greet|greeting|greetings)\b/],
  ["PRT-000302", /\b(?:bark|barks|barking|quiet interval)\b/],
  ["PRT-000303", /\b(?:chew|chewing|chews|destruction|destructive)\b/],
  ["PRT-000304", /\b(?:dig|digs|digging)\b/],
  ["PRT-000305", /\b(?:fearful|scared|afraid|confidence)\b/],
  ["PRT-000306", /\b(?:reactivity|reactive|lunges?|lunging)\b/],
  ["PRT-000307", /\b(?:resource guarding|guards?|guarding|growls?)\b/],
  ["PRT-000308", /\b(?:children|child|toddler|multi dog|multiple dogs)\b/],
  ["PRT-000401", /\b(?:retrieve|retrieving|fetch)\b|\bbring\b.*\b(?:toy|ball|back)\b/],
  ["PRT-000402", /\b(?:object name|named (?:item|object)|discrimination)\b/],
  ["PRT-000403", /\b(?:find it|nosework|scent games?|food search)\b/],
  ["PRT-000404", /\bfront\b/], ["PRT-000405", /\bfinish\b/],
  ["PRT-000406", /\b(?:back up|backward|backwards)\b/], ["PRT-000407", /\bspin\b/],
  ["PRT-000408", /\bgo around\b/], ["PRT-000409", /\b(?:under|through)\b.*\b(?:obstacle|tunnel|route)\b/],
  ["PRT-000410", /\bpaws up\b/],
  ["EDU-000501", /\b(?:puppy|puppies)\b.*\b(?:social|socialization|exposure|experiences)\b/],
  ["EDU-000502", /\b(?:adolescent|adolescence|teenage|teenager|regression)\b/],
  ["EDU-000503", /\b(?:exercise|enrichment|rest|sleep)\b.*\b(?:plan|planning|routine)\b/],
  ["EDU-000506", /\b(?:senior|older|old)\b.*\b(?:comfort|accessibility|behavior)\b/],
  ["NUT-002", /\b(?:adequacy|complete and balanced|food label|nutritional statement)\b/],
  ["NUT-004", /\b(?:ledger|calories|daily food|food diary)\b/],
  ["NUT-005", /\b(?:weight|fat|muscle)\b.*\b(?:track|tracking|record)\b/],
  ["NUT-006", /\b(?:puppy|puppies|growth)\b.*\b(?:nutrition|feeding|food|diet)\b/],
  ["NUT-007", /\b(?:senior|older|old)\b.*\b(?:feeding|food|diet|nutrition)\b/],
  ["NUT-008", /\b(?:change|changing|switch|switching|transition)\b.*\b(?:foods?|diet)\b/],
  ["NUT-009", /\b(?:water|drinking|hydration)\b/],
  ["NUT-010", /\braw\b.*\b(?:food|feeding|diet)\b/],
  ["NUT-011", /\b(?:homemade|home cooked|home prepared)\b.*\b(?:food|diet|recipe)\b/],
  ["NUT-013", /\b(?:allergy|allergies|intolerance)\b/],
];

const OUTSIDE_DOMAIN = /\b(?:mortgage|cryptocurrency|crypto|stocks?|stockmarket|bank|banking|bitcoin|poetry|poem|translate|translation|quantum|javascript|python|computer|portrait|painting|paint|programming|css|react (?:js|hooks?|state|login|components?)|login screen|touch screen|stand mixer|weather (?:report|forecast)|(?:buy|bake|order) pizza|pizza recipe|car repair|engine repair|bumper)\b/;

export function topicHints(value) {
  const query = prepareInput(value);
  if (OUTSIDE_DOMAIN.test(query)) return [];
  const hints = TOPICS.map(([id, pattern]) => ({ id, match: pattern.exec(query) })).filter(item => item.match);
  return hints.sort((a, b) => a.match.index - b.match.index).map(item => item.id);
}

export function outsideDomain(value) { return OUTSIDE_DOMAIN.test(prepareInput(value)); }
