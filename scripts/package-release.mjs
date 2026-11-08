import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const usage = "Usage: node scripts/package-release.mjs --output <new-directory-outside-source>";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function inside(parent, candidate) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  const path = relative(normalize(parent), normalize(candidate));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Resolve existing parent junctions/symlinks before creating a new destination.
async function canonicalNewPath(path) {
  let parent = dirname(path);
  const suffix = [basename(path)];
  while (!await exists(parent)) {
    suffix.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent) throw new Error("Output has no existing parent directory.");
    parent = next;
  }
  if (!(await stat(parent)).isDirectory()) throw new Error("Output parent is not a directory.");
  return resolve(await realpath(parent), ...suffix);
}

async function readDist(directory, prefix = "dist") {
  const entries = [];
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, item.name);
    const name = `${prefix}/${item.name}`;
    if (item.isSymbolicLink()) throw new Error(`Refusing a symbolic link in generated output: ${name}`);
    if (item.isDirectory()) entries.push(...await readDist(path, name));
    else if (item.isFile()) entries.push({ path: name, data: await readFile(path) });
    else throw new Error(`Unsupported generated output entry: ${name}`);
  }
  return entries;
}

async function main() {
  let output;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--help") { console.log(usage); return; }
    let value;
    if (args[index] === "--output") value = args[++index];
    else if (args[index].startsWith("--output=")) value = args[index].slice(9);
    else throw new Error(`Unknown argument: ${args[index]}. ${usage}`);
    if (output || !value || value.startsWith("--")) throw new Error(usage);
    output = resolve(value);
  }
  if (!output) throw new Error(usage);
  if (output === parse(output).root || inside(root, output) || inside(output, root)) {
    throw new Error("Output must be a new directory outside the source tree.");
  }
  if (await exists(output)) throw new Error("Output already exists; refusing to overwrite it.");
  const canonicalOutput = await canonicalNewPath(output);
  if (inside(root, canonicalOutput) || inside(canonicalOutput, root)) {
    throw new Error("Output resolves inside or around the source tree through a junction/symlink.");
  }

  const dist = join(root, "dist");
  const distStat = await lstat(dist);
  if (!distStat.isDirectory() || distStat.isSymbolicLink()) throw new Error("Build dist/ before packaging; it must be a real directory.");
  const serverPath = join(root, "server.mjs");
  const serverStat = await lstat(serverPath);
  if (!serverStat.isFile() || serverStat.isSymbolicLink()) throw new Error("server.mjs must be a real file.");
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const site = JSON.parse(await readFile(join(root, "site.config.json"), "utf8"));
  const targetHostname = new URL(site.canonicalUrl).hostname;
  if (typeof version !== "string" || !version || typeof targetHostname !== "string" || !targetHostname) {
    throw new Error("Package version and configured target hostname are required.");
  }
  const files = await readDist(dist);
  const infoFile = files.find((file) => file.path === "dist/BUILD-INFO.json");
  if (!infoFile || !files.some((file) => file.path === "dist/index.html")) throw new Error("Generated dist/ is incomplete.");
  const buildInfo = JSON.parse(infoFile.data.toString("utf8"));
  if (buildInfo.version !== version) throw new Error("dist/ version does not match package.json; rebuild before packaging.");
  const server = await readFile(serverPath);
  const deployGuide = `Supreme Canine Academy ${version}\n\nOfficial public hostname: ${targetHostname}\n\nThis package contains dist/, server.mjs, this guide, and RELEASE.json. The manifest records byte lengths and SHA-256 checksums. Packaging does not run QA, publish, enable cloud services, or change DNS.\n\nRun tests, build, browser checks, and checksum verification before publication. Preserve the previous release for rollback.\n\nServe dist/ at the origin root of your own static host, or run:\n  node server.mjs --dist\n\nThe included server requires Node.js 22.4 or later, no npm install, and defaults to 127.0.0.1:4173. Configure HOST and PORT for your own HTTPS reverse proxy.\n\nForks must update the canonical/brand metadata before publishing and review provider costs. No production credentials or automatic deployment are included. Keep LICENSE, CONTENT-LICENSE.md, FREE-ACCESS.md, and third-party notices with distributed copies. Hosted backend features remain disabled by default.\n`;
  files.push({ path: "server.mjs", data: server }, { path: "README-DEPLOY.txt", data: Buffer.from(deployGuide) });

  await mkdir(dirname(output), { recursive: true });
  // Non-recursive creation atomically refuses a destination created concurrently.
  await mkdir(output);
  if (await realpath(output) !== canonicalOutput) throw new Error("Output location changed while packaging.");
  for (const file of files) {
    const destination = join(output, ...file.path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.data, { flag: "wx" });
  }

  // A concurrent build must not silently turn the package into a mixed snapshot.
  const currentDist = await readDist(dist);
  const originalDist = files.filter((file) => file.path.startsWith("dist/"));
  if (JSON.stringify(currentDist.map((file) => [file.path, sha256(file.data)])) !== JSON.stringify(originalDist.map((file) => [file.path, sha256(file.data)])) || sha256(await readFile(serverPath)) !== sha256(server)) {
    throw new Error("Generated output changed during packaging. The incomplete directory has no RELEASE.json; use a fresh output after the build finishes.");
  }
  const manifest = {
    application: "Supreme Canine Academy", version, targetHostname,
    createdAt: new Date().toISOString(), packageStatus: "packaged; publication and QA are separate steps",
    recordCount: buildInfo.record_count, productionEligibleRecordCount: buildInfo.production_eligible_count,
    hostedBackendDefault: buildInfo.hosted_backend_default,
    files: files.map((file) => ({ path: file.path, bytes: file.data.length, sha256: sha256(file.data) })).sort((a, b) => a.path.localeCompare(b.path)),
  };
  await writeFile(join(output, "RELEASE.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ output, version, targetHostname, fileCount: manifest.files.length }));
}

try { await main(); }
catch (error) { console.error(`Packaging failed: ${error.message}`); process.exitCode = 1; }
