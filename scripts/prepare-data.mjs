import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "data", "knowledge.json");
const corpus = JSON.parse(await readFile(target, "utf8"));
const publicFields = new Set(["id", "title", "summary", "body", "display_body", "status", "production_eligible", "type", "risk_level", "topics", "aliases"]);
const ids = new Set();
const privateText = /(?:SRC-\d+|batch\d+provenance|provenance registry|evidence keys:|source_ids:)/i;

if (!Array.isArray(corpus.records) || corpus.records.length !== 67 || corpus.record_count !== 67 || corpus.production_eligible_count !== 0) {
  throw new Error("Expected the bundled 67-record review corpus with zero production-eligible records.");
}
for (const record of corpus.records) {
  if (!record || typeof record !== "object" || !record.id || ids.has(record.id)) throw new Error("Corpus IDs must be present and unique.");
  ids.add(record.id);
  if (Object.keys(record).some(key => !publicFields.has(key))) throw new Error(`Unexpected or private field in ${record.id}.`);
  if (record.production_eligible !== false || !["draft", "review_required"].includes(record.status)) throw new Error(`Review boundary failed for ${record.id}.`);
  if (!["protocol", "education", "triage"].includes(record.type)) throw new Error(`Unsupported record type in ${record.id}.`);
  for (const key of ["title", "summary", "body", "display_body"]) {
    if (typeof record[key] !== "string" || privateText.test(record[key])) throw new Error(`Invalid reader text in ${record.id}.${key}.`);
  }
  if (![record.topics, record.aliases].every(items => Array.isArray(items) && items.every(item => typeof item === "string"))) {
    throw new Error(`Topics and aliases must be text lists in ${record.id}.`);
  }
}

// The public reader payload is authoritative. Never reach into a sibling private
// corpus or rewrite the committed data as a side effect of testing/building.
console.log(`Validated ${corpus.records.length} bundled review records; no external files or cloud credentials required.`);
