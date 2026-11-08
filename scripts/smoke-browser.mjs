#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = `Usage: node scripts/smoke-browser.mjs [--url <public-url>] [--output <new-report.json>]

Requires Node.js 22.4+ (24 LTS recommended) and an installed Chrome, Chromium, or Microsoft Edge.
Set BROWSER_PATH to override browser discovery. No browser is downloaded.

By default, run npm run build first; this script starts and stops its own
loopback server against dist/. A fresh temporary browser profile is always used.
--url checks an existing site read-only and skips local profile save/remove.
--output optionally saves JSON to a new file; existing files are not overwritten.
Reports and screenshots are not written by default. Browser sandboxing stays on.`;
const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const report = { checks: [], exceptions: [], consoleErrors: [], blockedWrites: [] };
let browser;
let server;
let profileDirectory;
let temporaryRoot;
let client;
let interrupted = false;

function options() {
  const result = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") { result.help = true; continue; }
    if (!["--url", "--output"].includes(argument)) throw new Error(`Unknown option: ${argument}\n${usage}`);
    const value = args[++index];
    const key = argument.slice(2);
    if (!value || value.startsWith("--") || result[key]) throw new Error(`Provide ${argument} once with a value.`);
    result[key] = value;
  }
  if (result.url) {
    const url = new URL(result.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("--url must be an HTTP(S) URL without embedded credentials.");
    }
    result.url = url.href;
  }
  if (result.output) result.output = resolve(result.output);
  return result;
}

function publicUrl(value) {
  try { const url = new URL(value); return url.origin + url.pathname; }
  catch { return "[unavailable URL]"; }
}

function sanitized(message) {
  let value = String(message).replace(/https?:\/\/[^\s"'<>]+/g, publicUrl);
  if (profileDirectory) value = value.split(profileDirectory).join("[temporary profile]");
  return value.split(homedir()).join("[home]").slice(0, 500);
}

function check(name, passed, evidence) {
  report.checks.push({ name, passed: Boolean(passed), ...(evidence === undefined ? {} : { evidence }) });
  if (!passed) throw new Error(`Browser smoke failed: ${name}`);
}

async function executable(path) {
  try { return (await stat(path)).isFile() && await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK).then(() => true); }
  catch { return false; }
}

async function findBrowser() {
  if (process.env.BROWSER_PATH) {
    const path = resolve(process.env.BROWSER_PATH);
    if (await executable(path)) return path;
    throw new Error("BROWSER_PATH does not point to an executable Chrome/Chromium/Edge file.");
  }
  const candidates = [];
  if (process.platform === "win32") {
    for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(join(base, "Google", "Chrome", "Application", "chrome.exe"), join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (process.platform === "darwin") {
    for (const base of ["/Applications", join(homedir(), "Applications")]) {
      candidates.push(join(base, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"), join(base, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"), join(base, "Chromium.app", "Contents", "MacOS", "Chromium"));
    }
  }
  for (const directory of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"]) {
      candidates.push(join(directory, process.platform === "win32" ? `${name}.exe` : name));
    }
  }
  for (const path of [...new Set(candidates)]) if (await executable(path)) return path;
  throw new Error("No supported browser found. Install Google Chrome, Chromium, or Microsoft Edge, or set BROWSER_PATH to its executable. No browser was downloaded.");
}

function startProcess(command, args, extra = {}) {
  const state = { child: spawn(command, args, { cwd: root, stdio: ["ignore", "ignore", "pipe"], windowsHide: true, ...extra }), error: null, exited: false, stderr: "" };
  state.child.on("error", (error) => { state.error = error; });
  state.child.on("exit", () => { state.exited = true; });
  state.child.stderr?.on("data", (chunk) => { state.stderr = (state.stderr + String(chunk)).slice(-8000); });
  return state;
}

async function waitUntil(action, description, timeout = 15000, processState) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Browser smoke interrupted.");
    if (processState?.error) throw processState.error;
    if (processState?.exited) {
      const details = processState.stderr.split("\n").filter((line) => !line.includes("DevTools listening")).join("\n");
      throw new Error(`${description}: process exited. ${sanitized(details)} Keep the browser sandbox enabled and run as a normal user.`);
    }
    try { const value = await action(); if (value) return value; } catch { /* Retry while the owned process starts. */ }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function freePort() {
  const probe = createServer();
  await new Promise((done, fail) => { probe.once("error", fail); probe.listen(0, "127.0.0.1", done); });
  const port = probe.address().port;
  await new Promise((done, fail) => probe.close((error) => error ? fail(error) : done()));
  return port;
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.nextId = 0;
    this.confirmNext = false;
    this.socket.addEventListener("message", (event) => this.receive(JSON.parse(event.data)));
    this.socket.addEventListener("close", () => {
      for (const entry of this.pending.values()) entry.reject(new Error("Owned browser connection closed."));
      this.pending.clear();
    });
  }

  async connect() {
    await new Promise((done, fail) => { this.socket.addEventListener("open", done, { once: true }); this.socket.addEventListener("error", () => fail(new Error("Could not connect to the owned browser.")), { once: true }); });
    for (const method of ["Page.enable", "Runtime.enable", "Network.enable", "Log.enable"]) await this.send(method);
    await this.send("Network.setBypassServiceWorker", { bypass: true });
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    // A smoke run must not submit requests to a production account/API endpoint.
    await this.send("Fetch.enable", { patterns: [{ urlPattern: "http*", requestStage: "Request" }] });
  }

  receive(message) {
    if (message.id && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
      return;
    }
    const params = message.params;
    if (message.method === "Runtime.exceptionThrown") report.exceptions.push({ type: params.exceptionDetails.exception?.className || params.exceptionDetails.text, line: params.exceptionDetails.lineNumber });
    if (message.method === "Log.entryAdded" && params.entry.level === "error") report.consoleErrors.push(sanitized(params.entry.text));
    if (message.method === "Fetch.requestPaused") {
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes(params.request.method);
      if (!readOnly) report.blockedWrites.push({ method: params.request.method, url: publicUrl(params.request.url) });
      this.send(readOnly ? "Fetch.continueRequest" : "Fetch.failRequest", readOnly ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: "BlockedByClient" }).catch(() => {});
    }
    if (message.method === "Page.javascriptDialogOpening") {
      const accept = this.confirmNext && params.type === "confirm";
      this.confirmNext = false;
      this.send("Page.handleJavaScriptDialog", { accept }).catch(() => {});
    }
  }

  send(method, params = {}) {
    return new Promise((done, fail) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); fail(new Error(`Browser command timed out: ${method}`)); }, 10000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); done(value); }, reject: (error) => { clearTimeout(timer); fail(error); } });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.className || response.exceptionDetails.text);
    return response.result?.value;
  }

  async click(selector) {
    const clicked = await this.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element||element.disabled)return false;const visible=typeof element.checkVisibility==='function'?element.checkVisibility({checkVisibilityCSS:true}):element.getClientRects().length>0;if(!visible)return false;element.click();return true;})()`);
    if (!clicked) throw new Error(`Required control unavailable: ${selector}`);
  }

  async wait(expression, description) {
    return waitUntil(() => this.evaluate(expression), description, 15000, browser);
  }
}

async function stopProcess(state) {
  if (!state || state.exited) return;
  state.child.kill();
  for (let attempt = 0; attempt < 30 && !state.exited; attempt += 1) await sleep(100);
  if (!state.exited) state.child.kill("SIGKILL");
}

async function cleanup() {
  if (client?.socket.readyState === WebSocket.OPEN) {
    try { await client.send("Browser.close"); } catch { /* The browser may already have exited. */ }
    client.socket.close();
    for (let attempt = 0; attempt < 20 && !browser.exited; attempt += 1) await sleep(100);
  }
  await stopProcess(browser);
  await stopProcess(server);
  if (profileDirectory) {
    // Delete only the exact directory created by this run, never an existing profile.
    const resolved = await realpath(profileDirectory);
    if (dirname(resolved) !== temporaryRoot || !basename(resolved).startsWith("sca-browser-smoke-")) throw new Error("Refusing to clean a profile outside this run's temporary directory.");
    await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
}

async function main() {
  const settings = options();
  if (settings.help) { console.log(usage); return; }
  if (Number(process.versions.node.split(".")[0]) < 24 || typeof WebSocket !== "function") throw new Error("Browser smoke requires Node.js 24 or later.");
  const browserPath = await findBrowser();
  let target = settings.url;
  report.mode = target ? "read-only existing site" : "owned local build";
  report.browser = basename(browserPath);
  report.startedAt = new Date().toISOString();
  try {
    if (!target) {
      try { await access(join(root, "dist", "index.html")); } catch { throw new Error("dist/index.html is missing. Run npm run build before npm run smoke:browser."); }
      const port = await freePort();
      target = `http://127.0.0.1:${port}/`;
      server = startProcess(process.execPath, [join(root, "server.mjs"), "--dist"], { env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) } });
      await waitUntil(async () => (await fetch(target, { signal: AbortSignal.timeout(1000) })).ok, "the owned local server", 10000, server);
    }
    report.url = publicUrl(target);
    temporaryRoot = await realpath(tmpdir());
    profileDirectory = await mkdtemp(join(temporaryRoot, "sca-browser-smoke-"));
    browser = startProcess(browserPath, ["--headless=new", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`, "--no-first-run", "--disable-sync", "--disable-extensions", "--disable-background-networking", "--disable-component-update", "about:blank"]);
    const debugPort = await waitUntil(async () => Number((await readFile(join(profileDirectory, "DevToolsActivePort"), "utf8")).split("\n")[0]), "the isolated browser debugger", 15000, browser);
    const tabs = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
    const tab = tabs.find((item) => item.type === "page");
    if (!tab) throw new Error("The isolated browser did not create a test tab.");
    client = new CdpClient(tab.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
    await client.send("Page.navigate", { url: target });
    await client.wait("document.querySelectorAll('.library-card').length===67&&!document.querySelector('#search-button').disabled", "the 67-entry library");
    check("public library loads with three real starters", await client.evaluate("document.querySelectorAll('.starter-card').length===3&&document.querySelector('#account-open').hidden&&document.querySelector('#cloud-consent-row').hidden"));
    check("Start fits a 320px viewport", await client.evaluate("Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)<=innerWidth"));
    await client.click(".starter-card");
    await client.wait("!!document.querySelector('.answer-title')", "the name-response answer");
    check("name-response starter shows real steps", await client.evaluate("document.querySelector('.answer-title').textContent.includes('Name response')&&document.querySelectorAll('.answer-steps li').length>0"));
    await client.click(".answer-card .citation-chip");
    check("source reader opens the intended lesson", await client.evaluate("document.querySelector('#source-dialog').open&&document.querySelector('.source-meta').textContent.includes('PRT-000112')"));
    await client.click('[data-close="source-dialog"]');
    await client.click("#show-library-view");
    await client.click('[data-library-filter="training"]');
    check("Training filter shows 45 lessons", await client.evaluate("document.querySelectorAll('.library-card').length===45"));
    await client.click("#library-clear-filters");
    check("clearing filters restores all 67 entries", await client.evaluate("document.querySelectorAll('.library-card').length===67"));
    check("Library fits a 320px viewport", await client.evaluate("Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)<=innerWidth"));
    await client.click("#manage-dogs");
    check("fresh isolated profile has no existing dogs", await client.evaluate("document.querySelector('#dogs-dialog').open&&document.querySelectorAll('.saved-dog-row').length===0"));
    if (settings.url) {
      report.skipped = [{ name: "synthetic profile save/remove", reason: "--url mode does not change the remote application's state; the default owned local server exercises these controls." }];
    } else {
      await client.evaluate("document.querySelector('#dog-name').value='Smoke test dog';document.querySelector('#dog-form').requestSubmit()");
      await client.wait("!document.querySelector('#dogs-dialog').open", "a successful local profile save");
      check("local profile save confirms success", await client.evaluate("document.querySelector('#profile-feedback').textContent.includes('Smoke test dog')&&JSON.parse(localStorage.getItem('sca.dog-profiles.v1.local-review')||'[]').length===1"));
      await client.click("#manage-dogs");
      client.confirmNext = true;
      await client.evaluate("[...document.querySelectorAll('.saved-dog-actions button')].find(button=>button.textContent==='Remove').click()");
      await client.wait("document.querySelectorAll('.saved-dog-row').length===0", "confirmed removal of the synthetic local profile");
      check("local profile removal preserves empty storage", await client.evaluate("JSON.parse(localStorage.getItem('sca.dog-profiles.v1.local-review')||'[]').length===0"));
    }
    await client.click('[data-close="dogs-dialog"]');
    await client.click("#privacy-open");
    check("privacy and safety dialog opens", await client.evaluate("document.querySelector('#privacy-dialog').open"));
    await client.click('[data-close="privacy-dialog"]');
    check("no outgoing write requests", report.blockedWrites.length === 0);
    check("no browser JavaScript or console errors", report.exceptions.length === 0 && report.consoleErrors.length === 0);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = sanitized(error.message);
  } finally {
    try { await cleanup(); } catch (error) { report.passed = false; report.cleanupError = sanitized(error.message); }
    report.completedAt = new Date().toISOString();
    if (settings.output) {
      await mkdir(dirname(settings.output), { recursive: true });
      await writeFile(settings.output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    }
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { interrupted = true; });
main().catch((error) => { console.error(sanitized(error.message)); process.exitCode = 1; });
