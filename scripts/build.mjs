import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const corpusPath = resolve(root, "data", "knowledge.json");
const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (corpus.records?.length !== 67 || Number(corpus.production_eligible_count) !== 0 || corpus.records.some((record) => record.production_eligible === true)) {
  throw new Error("Refusing to build: expected exactly 67 review-only records and zero production-approved records.");
}
for (const record of corpus.records) {
  if ("source_ids" in record || "source_record" in record || "provenance" in record) throw new Error(`Refusing to embed internal provenance fields in ${record.id}.`);
  if (/(?:SRC-\d+|batch\d+provenance|provenance registry|Evidence keys:|source_ids:)/i.test(`${record.title}\n${record.summary}\n${record.body}\n${record.display_body}`)) {
    throw new Error(`Refusing to embed internal provenance text in ${record.id}.`);
  }
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "index.html"), resolve(output, "index.html"));
await cp(resolve(root, "config.js"), resolve(output, "config.js"));
await cp(resolve(root, "config.example.js"), resolve(output, "config.example.js"));
await cp(resolve(root, "public"), output, { recursive: true });
await cp(resolve(root, "data"), resolve(output, "data"), { recursive: true });
await cp(resolve(root, "licenses"), resolve(output, "licenses"), { recursive: true });
await cp(resolve(root, "THIRD-PARTY-NOTICES.md"), resolve(output, "THIRD-PARTY-NOTICES.md"));
for (const notice of ["LICENSE", "CONTENT-LICENSE.md", "FREE-ACCESS.md"]) {
  await cp(resolve(root, notice), resolve(output, notice));
}
await mkdir(resolve(output, "src"), { recursive: true });
await cp(resolve(root, "src", "styles.css"), resolve(output, "src", "styles.css"));
await build({
  entryPoints: [resolve(root, "src", "main.js")],
  outfile: resolve(output, "app.bundle.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  sourcemap: false,
  legalComments: "eof",
});
await writeFile(resolve(output, "BUILD-INFO.json"), `${JSON.stringify({ app: "Supreme Canine Academy", version, record_count: 67, production_eligible_count: 0, model: null, hosted_backend_default: "disabled", deployment: "not deployed" }, null, 2)}\n`, "utf8");
console.log(`Built static app at ${output} (67 draft/review records, 0 approved; Firebase SDK bundled; hosted features disabled by default).`);
