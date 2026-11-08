import { createApp } from "./app.js";
import { createFirebaseRuntime } from "./firebase-runtime.js";
import { observeAppStatus } from "./app-status.js";

const modelStatus = document.querySelector("#model-status");
const searchButton = document.querySelector("#search-button");
const startupControls = document.querySelectorAll(".starter-card, #manage-dogs, #show-library-view, #open-library-from-lessons");
document.querySelector("#reload-update").addEventListener("click", () => location.reload());
startupControls.forEach((button) => { button.disabled = true; });
modelStatus.textContent = "Opening the library…";
searchButton.disabled = true;
try {
  const response = await fetch("/data/knowledge.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Corpus request returned ${response.status}.`);
  const corpus = await response.json();
  if (!Array.isArray(corpus.records) || corpus.records.length !== 67 || Number(corpus.production_eligible_count) !== 0) {
    throw new Error("The local review corpus failed its 67-record / zero-approved boundary check.");
  }
  let runtime = null;
  let hostedUnavailable = false;
  try {
    runtime = await createFirebaseRuntime(globalThis.SCA_CONFIG);
  } catch (error) {
    hostedUnavailable = true;
    console.warn("Academy hosted runtime was not initialized.", error?.message ?? "runtime initialization failed");
  }
  createApp(corpus, runtime ?? {});
  searchButton.disabled = false;
  startupControls.forEach((button) => { button.disabled = false; });
  modelStatus.textContent = hostedUnavailable
    ? "Library ready. Cloud features are temporarily unavailable."
    : `Library ready. ${corpus.records.length} entries available.`;
  const workerAllowed = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  let serviceWorker = null;
  try { serviceWorker = workerAllowed ? navigator.serviceWorker : null; }
  catch { modelStatus.textContent = "Library ready. Offline access is unavailable in this browser."; }
  observeAppStatus({
    serviceWorker,
    events: window,
    isOnline: () => navigator.onLine,
    onOffline: (offline) => { document.querySelector("#offline-status").hidden = !offline; },
    onUpdateReady: () => { document.querySelector("#app-update").hidden = false; },
  }).catch(() => {
    modelStatus.textContent = "Library ready. Offline access is unavailable in this browser.";
  });
} catch (error) {
  const region = document.querySelector("#answer-region");
  const card = document.createElement("section");
  card.className = "error-card";
  card.setAttribute("role", "alert");
  const heading = document.createElement("h2");
  heading.textContent = "The library could not be opened";
  const message = document.createElement("p");
  message.textContent = "Try loading it again. Your saved dog profiles are still on this device.";
  const retry = document.createElement("button");
  retry.className = "button button-primary";
  retry.type = "button";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => location.reload());
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "More details";
  const technicalMessage = document.createElement("p");
  technicalMessage.className = "fine-print";
  technicalMessage.textContent = String(error?.message ?? "The library is unavailable.").slice(0, 600);
  details.append(summary, technicalMessage);
  card.append(heading, message, retry, details);

  // Corpus-dependent controls have no usable flow if startup failed. Keep the
  // recovery action available instead of leaving apparently working buttons.
  document.querySelectorAll(".app-shell button, .header-actions button, .review-banner button").forEach((button) => {
    button.disabled = true;
  });
  region.replaceChildren(card);
  region.hidden = false;
  const quickStarts = document.querySelector("#quick-starts");
  if (quickStarts) quickStarts.hidden = true;
  document.querySelector("#library-count").textContent = "Library unavailable";
  document.querySelector("#library-nav-count").textContent = "—";
  modelStatus.textContent = "Library unavailable. Use Try again to reload it.";
  searchButton.disabled = true;
}
