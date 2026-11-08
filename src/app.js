import { buildAnswer, createSearchIndex, resolveQuery, OWNER_MARKERS, OWNER_POSITION_RULE } from "./retrieval.js";
import { authConfigStatus } from "./auth.js";
import { buildSourceAnswer } from "./source-answer.js";
import { normalizeInput, prepareInput } from "./input-language.js";
import { deleteProfile, readProfileState, resolveProfileStorage, selectProfile, upsertProfile, writeProfiles } from "./profiles.js";

const byId = (id) => document.getElementById(id);
const text = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(value ?? "");
  return element;
};

const sourceHeadings = Object.freeze({
  goal: "Goal",
  advance: "Advance",
  advance_if: "Move forward when",
  avoid: "Avoid",
  observable_target: "What to look for",
  topics: "Topics",
  aliases: "Also known as",
  eligibility: "Good fit when",
  prerequisites: "Before you begin",
  contraindications: "Pause before starting",
  clarifying_questions: "Questions to check first",
  baseline_measurement: "Starting point",
  setup: "Setup",
  equipment: "What you’ll need",
  welfare_checks: "Comfort and safety",
  steps: "Practice steps",
  handler_action: "Handler action",
  observe: "What to notice",
  feedback_plan: "Feedback and reward",
  regress_if: "Make it easier when",
  stop_if: "Pause or stop if",
  dose: "Practice dose",
  generalization: "Practice in other settings",
  individual_adjustments: "Individual adjustments",
  limitations: "Limits of this guidance",
  maintenance: "Maintenance",
  next_action: "Next action",
  observed_problem: "Observed problem",
  possible_explanations: "Possible explanations",
  progression: "Progression",
  rationale: "Why this helps",
  refer: "Get professional help when",
  regress: "Regression",
  repeat: "Repeat",
  session_plan: "Session plan",
  stop: "When to stop",
  troubleshooting: "Troubleshooting",
  heel: "Heel cue",
  off: "Off cue",
  stand: "Stand cue",
  touch: "Touch cue",
  stop_conditions: "When to stop"
});

function cleanSourceText(value) {
  return String(value ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function renderSourceBody(value) {
  const container = document.createElement("div");
  container.className = "source-reading";
  const lines = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/<a\b[^>]*>\s*<\/a>/gi, "")
    .split("\n");
  let paragraphLines = [];
  let listItems = [];
  let listTag = "ul";
  let stepContainer = null;
  let stepNumber = 0;

  const currentContainer = () => stepContainer ?? container;
  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const raw = paragraphLines.join(" ").trim();
    const copy = cleanSourceText(raw);
    paragraphLines = [];
    if (!copy) return;
    const paragraph = text("p", "", copy);
    if (/^\*\*[^*]+\*\*/.test(raw)) paragraph.classList.add("source-callout");
    else if (stepContainer) paragraph.classList.add("source-step-detail");
    currentContainer().append(paragraph);
  };
  const flushList = () => {
    if (!listItems.length) return;
    const list = document.createElement(listTag);
    list.className = "source-list";
    for (const itemText of listItems) list.append(text("li", "", cleanSourceText(itemText)));
    currentContainer().append(list);
    listItems = [];
  };
  const flushBlocks = () => {
    flushParagraph();
    flushList();
  };
  const addHeading = (value) => {
    const heading = text("h4", "source-section-title", value);
    container.append(heading);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushBlocks();
      continue;
    }

    const markdownHeading = line.match(/^(#{1,6})\s+(.+)$/);
    if (markdownHeading) {
      flushBlocks();
      stepContainer = null;
      const heading = cleanSourceText(markdownHeading[2]);
      if (/^Supreme Canine Academy(?:\s|$)/i.test(heading) || /^(?:PRT|EDU|TRI)-\d{3,}/i.test(heading)) continue;
      addHeading(heading);
      continue;
    }

    const sourceField = line.match(/^([a-z][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (sourceField && (sourceField[1].toLowerCase() === "step_id" || Object.prototype.hasOwnProperty.call(sourceHeadings, sourceField[1].toLowerCase()))) {
      flushBlocks();
      const key = sourceField[1].toLowerCase();
      const value = sourceField[2].trim();
      if (key === "step_id") {
        stepNumber += 1;
        stepContainer = document.createElement("section");
        stepContainer.className = "source-step";
        stepContainer.append(text("h4", "source-step-title", `Step ${stepNumber}`));
        container.append(stepContainer);
        continue;
      }

      const label = sourceHeadings[key];
      if (!value) {
        stepContainer = null;
        addHeading(label);
        continue;
      }

      if (stepContainer) {
        stepContainer.append(text("h5", "source-detail-label", label));
      } else {
        stepContainer = null;
        addHeading(label);
      }
      currentContainer().append(text("p", "source-detail-value", cleanSourceText(value)));
      continue;
    }

    const step = line.match(/^(?:PRT|EDU|TRI)-\d+-S(\d+)$/i);
    if (step) {
      flushBlocks();
      stepNumber += 1;
      stepContainer = document.createElement("section");
      stepContainer.className = "source-step";
      stepContainer.append(text("h4", "source-step-title", `Step ${stepNumber}`));
      container.append(stepContainer);
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextTag = ordered ? "ol" : "ul";
      if (listItems.length && nextTag !== listTag) flushList();
      listTag = nextTag;
      listItems.push((unordered ?? ordered)[1]);
      continue;
    }

    flushList();
    if (stepContainer) {
      flushParagraph();
      paragraphLines.push(line);
      flushParagraph();
    } else {
      paragraphLines.push(line);
    }
  }
  flushBlocks();
  if (!container.childElementCount) container.append(text("p", "", "No readable passage was provided for this entry."));
  return container;
}

const ownerSource = Object.freeze({
  id: "SCA-MARKERS-001",
  title: "Owner-confirmed cue contract",
  status: "Owner-confirmed reference",
  summary: "This record is the owner-confirmed instruction for marker meanings and positional duration. It is not a training lesson or veterinary source.",
  display_body: `${OWNER_MARKERS.map((marker) => `${marker.cue}: ${marker.meaning}`).join("\n\n")}\n\n${OWNER_POSITION_RULE}\n\nDo not infer force or correction intensity.`
});

export function createApp(corpus, { storage, config = globalThis.SCA_CONFIG, authClient = null, accountClient = null, assistantClient = null } = {}) {
  const resolvedAuthClient = authClient ?? {
    enabled: false,
    async signIn() { throw new Error("Firebase Auth SDK is unavailable. Local review remains available."); },
    async createAccount() { throw new Error("Firebase Auth SDK is unavailable. Local review remains available."); },
    async signOut() { throw new Error("Firebase Auth SDK is unavailable."); },
  };
  const records = corpus.records;
  const searchIndex = createSearchIndex(records);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  let libraryCategory = "all";
  let activeSourceRecord = null;
  let account = null;
  let authSession = null;
  let authMode = "signin";
  let storageScope = "local-review";
  const profileStorage = resolveProfileStorage(storage);
  let profileState = readProfileState(profileStorage, storageScope);
  let profiles = profileState.profiles;
  let selectedDogId = "";
  let lastQuery = "";

  const dogSelect = byId("dog-select");
  const answerRegion = byId("answer-region");
  const errorMessage = byId("error-message");
  const motionBehavior = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  function revealAnswer() {
    answerRegion.hidden = false;
    byId("quick-starts").hidden = true;
    const heading = answerRegion.querySelector(".answer-title");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.closest(".answer-card").scrollIntoView({ block: "start", behavior: motionBehavior() });
    }
  }

  function updateSessionSummary() {
    byId("session-summary").textContent = `${activeProfile()?.name ?? "Optional"} · ${byId("minutes").value} min`;
  }

  function showProfileFeedback(message) {
    byId("profile-feedback").textContent = message;
    byId("profile-feedback").hidden = false;
  }

  function showDogDataError(message, focus = false) {
    const error = byId("dog-data-error");
    error.textContent = message ?? "";
    error.hidden = !message;
    if (message && focus && byId("dogs-dialog").open) {
      error.tabIndex = -1;
      error.focus({ preventScroll: true });
      error.scrollIntoView({ block: "center", behavior: motionBehavior() });
    }
  }

  function loadProfileScope() {
    profileState = readProfileState(profileStorage, storageScope);
    profiles = profileState.profiles;
    showDogDataError(profileState.error);
  }

  function activeProfile() { return selectProfile(profiles, selectedDogId); }

  function clearConversation(reason = "Dog selection changed. The previous conversation was cleared to keep profiles separate.") {
    lastQuery = "";
    byId("cloud-consent").checked = false;
    answerRegion.replaceChildren();
    answerRegion.append(text("p", "inline-notice", reason));
    answerRegion.hidden = false;
    byId("quick-starts").hidden = false;
  }

  function renderDogContext() {
    const profile = activeProfile();
    if (!profile) {
      byId("dog-context").textContent = "A profile is optional. You can start with the library.";
      updateSessionSummary();
      return;
    }
    const facts = [profile.age && `age/stage: ${profile.age}`, profile.breed && `breed/mix: ${profile.breed}`, profile.goals && `goal: ${profile.goals}`].filter(Boolean);
    byId("dog-context").textContent = `${profile.name}${facts.length ? ` · ${facts.join(" · ")}` : ""}. Saved on this device.`;
    updateSessionSummary();
  }

  function renderDogSelect() {
    const previous = selectedDogId;
    dogSelect.replaceChildren(new Option("No dog selected", ""));
    for (const profile of profiles) {
      dogSelect.add(new Option(`${profile.name}${profile.breed ? ` · ${profile.breed}` : ""}`, profile.id));
    }
    selectedDogId = profiles.some((profile) => profile.id === previous) ? previous : "";
    dogSelect.value = selectedDogId;
    renderDogContext();
  }

  function renderLibrary(filter = byId("library-search").value) {
    const query = prepareInput(filter);
    const matchesCategory = (record) => libraryCategory === "all"
      || (libraryCategory === "training" ? record.type === "protocol" : record.type !== "protocol");
    const phrase = query ? new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) : null;
    const exactMatch = (record) => !query || phrase.test(normalizeInput([record.title, record.summary, record.body, record.display_body, ...(record.topics ?? []), ...(record.aliases ?? [])]
      .filter(Boolean)
      .join(" ")));
    const hasExactMatch = records.some(record => matchesCategory(record) && exactMatch(record));
    const fallbackIds = query && !hasExactMatch ? new Set(searchIndex.search(query, records.length).map(hit => hit.record.id)) : null;
    const matchesQuery = record => fallbackIds ? fallbackIds.has(record.id) : exactMatch(record);
    const visibleRecords = records.filter((record) => matchesCategory(record) && matchesQuery(record))
      .sort((left, right) => left.title.localeCompare(right.title));
    const host = byId("library-results");
    host.setAttribute("aria-busy", "true");
    host.replaceChildren();

    for (const record of visibleRecords) {
      const card = document.createElement("article");
      card.className = "library-card";
      const cardHeader = document.createElement("div");
      cardHeader.className = "library-card-header";
      const typeLabel = record.type === "protocol" ? "Training lesson" : record.type === "triage" ? "Safety guide" : "Care guide";
      cardHeader.append(text("span", `record-type record-type-${record.type}`, typeLabel));
      cardHeader.append(text("span", "draft-badge", record.status === "review_required" ? "Needs review" : "Review draft"));

      const title = text("h2", "library-card-title", record.title);
      const summary = text("p", "library-card-summary", record.summary);
      const topics = document.createElement("ul");
      topics.className = "topic-list";
      topics.setAttribute("aria-label", "Topics");
      for (const topic of (record.topics ?? []).slice(0, 3)) topics.append(text("li", "topic-chip", String(topic).replace(/_/g, " ")));

      const footer = document.createElement("div");
      footer.className = "library-card-footer";
      const open = text("button", "text-button library-open", record.type === "protocol" ? "Read lesson →" : "Read guide →");
      open.type = "button";
      open.setAttribute("aria-label", `Read ${record.title}, review draft`);
      open.addEventListener("click", () => openSource(record.id));
      footer.append(open);
      card.append(cardHeader, title, summary);
      if (topics.childElementCount) card.append(topics);
      card.append(footer);
      host.append(card);
    }

    const allCount = records.length;
    const trainingCount = records.filter((record) => record.type === "protocol").length;
    const referenceCount = allCount - trainingCount;
    byId("library-nav-count").textContent = String(allCount);
    byId("library-count").textContent = query || libraryCategory !== "all"
      ? `${visibleRecords.length} of ${libraryCategory === "all" ? allCount : libraryCategory === "training" ? trainingCount : referenceCount} entries`
      : `${visibleRecords.length} entries`;
    byId("library-empty").hidden = visibleRecords.length > 0;
    byId("library-clear-filters").hidden = !query && libraryCategory === "all";
    byId("library-results").setAttribute("aria-busy", "false");
    document.querySelectorAll("[data-library-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.libraryFilter === libraryCategory));
    });
  }

  function clearLibraryFilters() {
    libraryCategory = "all";
    byId("library-search").value = "";
    renderLibrary();
  }

  function setWorkspaceView(view) {
    const showLibrary = view === "library";
    byId("ask-view").hidden = showLibrary;
    byId("library-view").hidden = !showLibrary;
    byId("show-ask-view").setAttribute("aria-pressed", String(!showLibrary));
    byId("show-library-view").setAttribute("aria-pressed", String(showLibrary));
    document.querySelector(".skip-link").href = showLibrary ? "#library-title" : "#page-title";
    window.scrollTo({ top: 0, behavior: motionBehavior() });
    byId(showLibrary ? "library-title" : "page-title").focus({ preventScroll: true });
  }

  function openSource(recordId) {
    const record = recordId === ownerSource.id ? ownerSource : recordsById.get(recordId);
    if (!record) return;
    activeSourceRecord = record === ownerSource ? null : record;
    const host = byId("source-content");
    host.replaceChildren();
    const meta = text("p", "source-meta", `${record.id} · ${record === ownerSource ? "Owner-confirmed reference" : "Review draft"}`);
    const summary = text("p", "source-summary", record.summary);
    const title = text("h3", "source-record-title", record.title);
    title.id = "source-record-heading";
    const body = renderSourceBody(record.display_body || record.body || record.summary);
    host.append(meta, title, summary, body);
    byId("source-ask").hidden = !activeSourceRecord;
    byId("source-title").textContent = record === ownerSource ? "Cue reference" : record.type === "protocol" ? "Training lesson" : "Care guide";
    byId("source-steps").hidden = !body.querySelector(".source-step");
    byId("source-overview").textContent = record.type === "protocol" ? "Before you begin" : "Read from start";
    byId("source-dialog").setAttribute("aria-labelledby", "source-record-heading");
    byId("source-dialog").showModal();
    host.scrollTop = 0;
  }

  function citationButtons(answer) {
    const ids = [...new Set(answer?.citations ?? [])];
    if (!ids.length) return null;
    const row = document.createElement("div");
    row.className = "citation-row";
    row.append(text("span", "citation-label", "From the library"));
    for (const id of ids) {
      const record = id === ownerSource.id ? ownerSource : recordsById.get(id);
      if (!record) continue;
      const button = text("button", "citation-chip", `${record === ownerSource ? "Read cue reference" : record.type === "protocol" ? "Read full lesson" : "Read full guide"} →`);
      button.setAttribute("aria-label", `Read source: ${record.title}`);
      button.type = "button";
      button.addEventListener("click", () => openSource(id));
      row.append(button);
    }
    return row;
  }

  function openHostedCitation(citation) {
    activeSourceRecord = null;
    const host = byId("source-content");
    host.replaceChildren();
    const isOwnerReference = citation.documentId === "SCA-MARKERS-001";
    host.append(
      text("p", "source-meta", `${citation.documentId} · ${isOwnerReference ? "owner-confirmed reference" : "approved hosted Academy record"}`),
      text("h3", "source-record-title", isOwnerReference ? "Owner-confirmed cue contract" : citation.title),
      text("p", "source-summary", citation.pageStart === null
        ? citation.section
        : `${citation.section} · pages ${citation.pageStart}-${citation.pageEnd}`),
      renderSourceBody(citation.excerpt || "The backend did not provide a passage excerpt."),
    );
    host.querySelector(".source-record-title").id = "source-record-heading";
    byId("source-title").textContent = "Source guide";
    byId("source-dialog").setAttribute("aria-labelledby", "source-record-heading");
    byId("source-steps").hidden = !host.querySelector(".source-step");
    byId("source-overview").textContent = "Read from start";
    byId("source-ask").hidden = true;
    byId("source-dialog").showModal();
    host.scrollTop = 0;
  }

  function renderHostedAnswer(result, query) {
    answerRegion.replaceChildren();
    const labels = {
      answer: "Approved Academy passage",
      "not-found-in-academy": "No approved passage found",
      "safety-escalation": "Safety referral",
      "access-pending": "Beta access pending",
      "assistant-disabled": "Hosted service disabled",
      "rate-limited": "Request limit reached",
    };
    const article = document.createElement("article");
    article.className = `answer-card answer-${result.status}`;
    const topper = document.createElement("div");
    topper.className = "answer-topper";
    topper.append(text("span", "answer-kind", labels[result.status] || "Hosted Academy response"));
    topper.append(text("span", "answer-kind", "Retrieval only · no model generated"));
    const ownerContractAnswer = result.citations?.some((citation) => citation.documentId === "SCA-MARKERS-001");
    if (result.status === "answer" && ownerContractAnswer) {
      topper.firstChild.textContent = "Owner-confirmed cue reference";
    }
    article.append(topper, text("h2", "answer-title", ownerContractAnswer ? "Owner-confirmed cue contract" : "Academy hosted library"));
    article.append(text("p", "answer-message hosted-answer-copy", result.answer));
    if (result.citations?.length) {
      const row = document.createElement("div");
      row.className = "citation-row";
      row.append(text("span", "citation-label", "Inspect cited source"));
      for (const citation of result.citations) {
        const title = citation.documentId === "SCA-MARKERS-001" ? "Owner-confirmed cue contract" : citation.title;
        const button = text("button", "citation-chip", `${citation.documentId} · ${title}`);
        button.type = "button";
        button.addEventListener("click", () => openHostedCitation(citation));
        row.append(button);
      }
      article.append(row);
    }
    article.append(text("p", "answer-privacy", "Only this question was sent. Dog profiles, session settings, and chat history were not included or saved."));
    answerRegion.append(article);
    lastQuery = query;
    revealAnswer();
  }

  function renderMatches(hits) {
    if (!hits.length) return null;
    const section = document.createElement("details");
    section.className = "matches-section related-guides";
    section.append(text("summary", "", `Related lessons & guides (${hits.length})`));
    const list = document.createElement("div");
    list.className = "match-list";
    for (const hit of hits) {
      const card = document.createElement("article");
      card.className = "match-card";
      const badge = text("span", "draft-badge", hit.record.status === "review_required" ? "Needs review" : "Review draft");
      const title = text("h3", "", hit.record.title);
      const summary = text("p", "match-summary", hit.record.summary);
      const open = text("button", "button button-secondary", hit.record.type === "protocol" ? "Read lesson" : "Read guide");
      open.type = "button";
      open.addEventListener("click", () => openSource(hit.record.id));
      card.append(badge, title, summary, open);
      list.append(card);
    }
    section.append(list);
    return section;
  }

  function renderAnswer(answer, hits, query, session) {
    answerRegion.replaceChildren();
    const article = document.createElement("article");
    article.className = `answer-card answer-${answer.kind}`;
    const topper = document.createElement("div");
    topper.className = "answer-topper";
    topper.append(text("span", answer.kind === "safety" ? "answer-kind safety-kind" : "answer-kind", answer.kind === "safety" ? "Safety first" : answer.kind === "owner-contract" ? "Cue reference" : answer.kind === "profile" ? "Saved dog details" : answer.kind === "no-match" ? "Try another search" : answer.kind === "guide" ? "Care guide · review draft" : "Training · review draft"));
    article.append(topper, text("h2", "answer-title", answer.title || "Review result"));

    if (answer.message) article.append(text("p", "answer-message", answer.kind === "no-match"
      ? "Try a skill such as name response, hand targeting or settling on a mat. You can also browse the full library."
      : answer.message));
    if (answer.kind === "no-match") {
      const browse = text("button", "button button-secondary", "Browse library →");
      browse.type = "button";
      browse.addEventListener("click", () => { clearLibraryFilters(); setWorkspaceView("library"); });
      article.append(browse);
    }
    const sectionLabels = {
      "Goal in this draft": "The goal",
      "First actions in source order": "Start here",
      "First actions from the draft": "Start here",
      "Setup": "Before you start",
      "What to observe": "What to look for",
      "When the draft says to progress": "When to make it harder",
    };
    for (const section of (answer.sections ?? [])) {
      const block = document.createElement("section");
      block.className = `answer-section${section.heading === "Stop or get help" ? " safety-check" : ""}`;
      block.append(text("h3", "", sectionLabels[section.heading] || section.heading));
      if (/^First actions/.test(section.heading)) {
        const steps = document.createElement("ol");
        steps.className = "answer-steps";
        for (const step of section.text.split("\n").filter((line) => line.trim())) {
          steps.append(text("li", "", step.replace(/^\d+[.)]\s*/, "")));
        }
        block.append(steps);
      } else {
        block.append(text("p", "answer-section-copy", section.text));
      }
      article.append(block);
    }
    if (answer.kind === "safety" && answer.note) article.append(text("p", "safety-footnote", answer.note));
    const citations = citationButtons(answer);
    if (citations) article.append(citations);

    const about = document.createElement("details");
    about.className = "answer-details";
    about.append(text("summary", "", "About this guidance"));
    if (answer.note && answer.kind !== "safety") about.append(text("p", "answer-note", answer.note));
    const profile = activeProfile();
    if (profile && answer.kind !== "profile") {
      const personal = document.createElement("div");
      personal.className = "profile-context-note";
      personal.append(text("strong", "", `Selected dog: ${profile.name}`));
      const known = [profile.goals && `Saved goal: ${profile.goals}`, profile.setting && `Setting: ${profile.setting}`].filter(Boolean);
      personal.append(text("p", "", known.length ? `${known.join(" · ")} — user-entered details; no other traits are inferred.` : "No training goal or setting is saved for this dog. No other traits are inferred."));
      about.append(personal);
    }

    if (answer.kind === "draft-plan") {
      const sessionBox = document.createElement("section");
      sessionBox.className = "session-context-note";
      sessionBox.append(text("h3", "", "Your session choices"));
      sessionBox.append(text("p", "", `${session.experience}; ${session.minutes} minutes planned${session.setting ? `; setting: ${session.setting}` : ""}.`));
      sessionBox.append(text("p", "session-context-caveat", "Planning choices do not change the source guidance. Stop sooner if your dog is uncomfortable."));
      about.append(sessionBox);
    }
    about.append(text("p", "answer-privacy", "Your question and this answer stay in this tab. This starting point uses the library text; it does not replace professional advice."));
    article.append(about);
    const another = text("button", "text-button ask-another", "Ask another question ↑");
    another.type = "button";
    another.addEventListener("click", () => {
      lastQuery = "";
      byId("question").value = "";
      byId("cloud-consent").checked = false;
      byId("quick-starts").hidden = false;
      byId("question").focus({ preventScroll: true });
      byId("question-form").scrollIntoView({ block: "start", behavior: motionBehavior() });
    });
    article.append(another);
    answerRegion.append(article);

    const secondaryHits = hits.filter((hit) => !(answer.citations ?? []).includes(hit.record.id));
    const matches = ["profile", "safety"].includes(answer.kind) ? null : renderMatches(secondaryHits);
    if (matches) answerRegion.append(matches);
    lastQuery = answer.safetyContext ?? query;
    revealAnswer();
  }

  async function performSearch(rawQuery, sourceRecord = null) {
    const query = String(rawQuery ?? "").trim().slice(0, 600);
    errorMessage.hidden = true;
    if (!query) {
      errorMessage.textContent = "Enter a question or choose a skill below.";
      errorMessage.hidden = false;
      return;
    }
    byId("profile-feedback").hidden = true;
    if (assistantClient?.enabled === true && byId("cloud-consent").checked) {
      if (!account) {
        errorMessage.textContent = "Sign in before choosing hosted processing. No question was sent.";
        errorMessage.hidden = false;
        byId("cloud-consent").checked = false;
        return;
      }
      const searchButton = byId("search-button");
      searchButton.disabled = true;
      searchButton.textContent = "Checking approved Academy passages…";
      answerRegion.hidden = false;
      byId("quick-starts").hidden = true;
      const loading = document.createElement("section");
      loading.className = "loading-card";
      loading.setAttribute("role", "status");
      loading.setAttribute("aria-live", "polite");
      loading.append(text("p", "loading-title", "Checking approved Academy passages…"));
      const loadingLines = document.createElement("div");
      loadingLines.className = "loading-lines";
      loadingLines.setAttribute("aria-hidden", "true");
      loadingLines.append(text("span", "loading-line", ""), text("span", "loading-line", ""), text("span", "loading-line loading-line-short", ""));
      loading.append(loadingLines);
      answerRegion.replaceChildren(loading);
      try {
        const answer = await assistantClient.ask(query, { cloudProcessingConsent: true });
        renderHostedAnswer(answer, query);
      } catch (error) {
        answerRegion.replaceChildren();
        answerRegion.hidden = true;
        byId("quick-starts").hidden = false;
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
        errorMessage.tabIndex = -1;
        errorMessage.focus({ preventScroll: true });
        errorMessage.scrollIntoView({ block: "center", behavior: motionBehavior() });
      } finally {
        byId("cloud-consent").checked = false;
        searchButton.disabled = false;
        searchButton.textContent = "Find guidance →";
      }
      return;
    }
    const hits = searchIndex.search(resolveQuery(query, lastQuery), 3);
    const context = { query, records, hits, profile: activeProfile(), previousQuery: lastQuery };
    const answer = sourceRecord ? buildSourceAnswer({ record: sourceRecord, ...context }) : buildAnswer(context);
    renderAnswer(answer, hits, query, {
      experience: byId("experience").value,
      setting: byId("setting").value.trim().slice(0, 80),
      minutes: byId("minutes").value
    });
  }

  function renderSavedDogs() {
    const host = byId("saved-dogs");
    host.replaceChildren();
    if (!profiles.length) {
      host.append(text("p", "empty-note", "No dog profiles saved on this device yet."));
      return;
    }
    for (const profile of profiles) {
      const card = document.createElement("article");
      card.className = "saved-dog-row";
      const details = document.createElement("div");
      details.append(text("strong", "saved-dog-name", profile.name));
      const facts = [profile.age, profile.breed, profile.goals].filter(Boolean);
      details.append(text("p", "saved-dog-facts", facts.join(" · ") || "No optional details entered."));
      const actions = document.createElement("div");
      actions.className = "saved-dog-actions";
      const choose = text("button", "text-button", selectedDogId === profile.id ? "Selected" : "Use for session");
      choose.type = "button";
      choose.disabled = selectedDogId === profile.id;
      choose.addEventListener("click", () => {
        dogSelect.value = profile.id;
        dogSelect.dispatchEvent(new Event("change", { bubbles: true }));
        renderSavedDogs();
        byId("dogs-dialog").close();
        showProfileFeedback(`${profile.name} selected for this session.`);
      });
      const edit = text("button", "text-button", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => fillDogForm(profile));
      const exportButton = text("button", "text-button", "Export");
      exportButton.type = "button";
      exportButton.addEventListener("click", () => exportProfile(profile));
      const remove = text("button", "text-button text-danger", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        if (profileState.error) { showDogDataError(profileState.error, true); return; }
        if (!globalThis.confirm(`Remove ${profile.name}'s local profile from this browser? This cannot be undone.`)) return;
        const nextProfiles = deleteProfile(profiles, profile.id);
        try {
          writeProfiles(nextProfiles, profileStorage, storageScope);
        } catch (error) {
          showDogDataError(error.message, true);
          return;
        }
        profiles = nextProfiles;
        if (selectedDogId === profile.id) {
          selectedDogId = "";
          renderDogSelect();
          clearConversation("The selected dog profile was removed. The prior conversation was cleared.");
        }
        renderDogSelect();
        renderSavedDogs();
        if (byId("dog-id").value === profile.id) fillDogForm(null);
        showDogDataError(null);
        byId("dog-name").focus();
      });
      actions.append(choose, edit, exportButton, remove);
      card.append(details, actions);
      host.append(card);
    }
  }

  function fillDogForm(profile) {
    byId("dog-id").value = profile?.id ?? "";
    byId("dog-name").value = profile?.name ?? "";
    byId("dog-age").value = profile?.age ?? "";
    byId("dog-breed").value = profile?.breed ?? "";
    byId("dog-goals").value = profile?.goals ?? "";
    byId("dog-setting").value = profile?.setting ?? "";
    byId("dog-comfort").value = profile?.comfort ?? "";
    byId("dog-form-title").textContent = profile ? `Edit ${profile.name}` : "Add a dog";
    byId("dog-more").open = Boolean(profile);
    showDogDataError(profileState.error);
    if (byId("dogs-dialog").open) byId("dog-name").focus();
  }

  function exportProfile(profile) {
    const blob = new Blob([`${JSON.stringify({ format: "supreme-canine-local-profile-v1", dog_profile: profile }, null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `sca-profile-${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dog"}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function refreshAccountUI() {
    byId("account-label").textContent = account?.email ?? "optional";
    byId("account-open").childNodes[0].textContent = account ? "Account " : "Sign in ";
    const state = authConfigStatus(config?.firebase, config?.mode);
    const authReady = resolvedAuthClient.enabled === true;
    byId("account-open").hidden = !account && (!authReady || !state.configured);
    byId("auth-description").textContent = account
      ? `Signed in as ${account.displayName ? `${account.displayName} · ` : ""}${account.email}. Session is held in memory only. Dog profiles stay on this device.`
      : "Local review mode works without an account. When configured by the owner, Firebase Auth can sign in or create an account. Dog profiles stay on this device; chats are not uploaded.";
    byId("auth-status").textContent = authReady ? state.message : state.configured
      ? "Firebase Auth is configured, but its SDK runtime did not initialize. Local review mode remains available."
      : state.message;
    byId("auth-submit").disabled = !authReady || !state.configured || Boolean(account);
    byId("auth-signout").hidden = !account;
    byId("auth-mode-signin").disabled = Boolean(account);
    byId("auth-mode-create").disabled = Boolean(account);
    byId("auth-username-row").hidden = authMode !== "create";
    byId("auth-username").required = authMode === "create";
    byId("cloud-consent-row").hidden = assistantClient?.enabled !== true;
    byId("question-privacy-copy").textContent = assistantClient?.enabled === true
      ? "Local search is the default. Hosted retrieval sends only this question when you check the consent box."
      : "Your question stays in this tab.";
  }

  function setAuthMode(mode) {
    authMode = mode === "create" ? "create" : "signin";
    const creating = authMode === "create";
    byId("auth-mode-signin").setAttribute("aria-pressed", String(!creating));
    byId("auth-mode-create").setAttribute("aria-pressed", String(creating));
    byId("auth-username-row").hidden = !creating;
    byId("auth-username").required = creating;
    byId("auth-confirm-row").hidden = !creating;
    byId("auth-password-confirm").required = creating;
    byId("auth-password").autocomplete = creating ? "new-password" : "current-password";
    byId("auth-submit").textContent = creating ? "Create account" : "Sign in";
  }

  byId("question-form").addEventListener("submit", (event) => {
    event.preventDefault();
    performSearch(byId("question").value);
  });
  document.querySelectorAll(".suggestion").forEach((button) => button.addEventListener("click", () => {
    byId("question").value = button.dataset.question;
    byId("cloud-consent").checked = false;
    performSearch(button.dataset.question);
  }));
  byId("question").addEventListener("input", () => { byId("cloud-consent").checked = false; });
  byId("show-ask-view").addEventListener("click", () => setWorkspaceView("ask"));
  byId("show-library-view").addEventListener("click", () => setWorkspaceView("library"));
  byId("open-library-from-lessons").addEventListener("click", () => {
    libraryCategory = "training";
    byId("library-search").value = "";
    renderLibrary();
    setWorkspaceView("library");
  });
  byId("library-search").addEventListener("input", (event) => renderLibrary(event.target.value));
  document.querySelectorAll("[data-library-filter]").forEach((button) => button.addEventListener("click", () => {
    libraryCategory = button.dataset.libraryFilter;
    renderLibrary();
  }));
  byId("library-clear-filters").addEventListener("click", () => {
    clearLibraryFilters();
    byId("library-search").focus();
  });
  document.querySelectorAll("[data-clear-library-filters]").forEach((button) => button.addEventListener("click", () => {
    clearLibraryFilters();
    byId("library-search").focus();
  }));
  byId("source-ask").addEventListener("click", () => {
    if (!activeSourceRecord) return;
    const title = activeSourceRecord.title.toLowerCase();
    const question = activeSourceRecord.type === "protocol"
      ? `How can I begin ${title}?`
      : `What should I know about ${title}?`;
    byId("source-dialog").close();
    byId("question").value = question;
    byId("cloud-consent").checked = false;
    setWorkspaceView("ask");
    byId("question").focus({ preventScroll: true });
    performSearch(question, activeSourceRecord);
  });
  byId("source-overview").addEventListener("click", () => {
    byId("source-content").scrollTo({ top: 0, behavior: motionBehavior() });
    const heading = byId("source-content").querySelector(".source-record-title");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  });
  byId("source-steps").addEventListener("click", () => {
    const step = byId("source-content").querySelector(".source-step");
    if (!step) return;
    step.tabIndex = -1;
    step.focus({ preventScroll: true });
    step.scrollIntoView({ block: "start", behavior: motionBehavior() });
  });
  ["experience", "minutes", "setting"].forEach((id) => byId(id).addEventListener("change", updateSessionSummary));
  dogSelect.addEventListener("change", () => {
    selectedDogId = dogSelect.value;
    renderDogContext();
    renderSavedDogs();
    clearConversation(selectedDogId ? "Dog selection changed. The previous conversation was cleared to prevent profile mixing." : "No dog selected. The previous conversation was cleared; no dog details will be assumed.");
  });
  byId("manage-dogs").addEventListener("click", () => {
    renderSavedDogs();
    byId("dogs-dialog").showModal();
    fillDogForm(null);
  });
  byId("dog-cancel").addEventListener("click", () => {
    byId("dog-form").reset();
    fillDogForm(null);
    byId("dogs-dialog").close();
  });
  byId("dog-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const existingId = byId("dog-id").value;
    const prior = profiles.find((profile) => profile.id === existingId);
    try {
      if (profileState.error) throw new Error(profileState.error);
      const nextProfiles = upsertProfile(profiles, {
        id: existingId || undefined,
        name: byId("dog-name").value,
        age: byId("dog-age").value,
        breed: byId("dog-breed").value,
        goals: byId("dog-goals").value,
        setting: byId("dog-setting").value,
        comfort: byId("dog-comfort").value
      });
      writeProfiles(nextProfiles, profileStorage, storageScope);
      profiles = nextProfiles;
      const saved = profiles.find((profile) => profile.id === (existingId || profiles[0].id));
      if (!selectedDogId || selectedDogId === prior?.id) {
        selectedDogId = saved?.id ?? "";
      }
      renderDogSelect();
      renderSavedDogs();
      byId("dog-data-error").hidden = true;
      byId("dog-form").reset();
      byId("dogs-dialog").close();
      fillDogForm(null);
      clearConversation("Your dog’s details are saved. Choose a skill or ask a new question.");
      showProfileFeedback(`${saved?.name ?? "Dog profile"} saved on this device.`);
    } catch (error) {
      showDogDataError(error.message, true);
    }
  });
  byId("account-open").addEventListener("click", () => {
    refreshAccountUI();
    byId("account-dialog").showModal();
  });
  byId("auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = byId("auth-status");
    status.textContent = authMode === "create" ? "Creating the Firebase Auth account." : "Connecting to Firebase Auth.";
    byId("auth-submit").disabled = true;
    try {
      const password = byId("auth-password").value;
      const username = byId("auth-username").value.trim().replace(/\s+/g, " ");
      const creatingAccount = authMode === "create";
      if (creatingAccount && password !== byId("auth-password-confirm").value) throw new Error("The passwords do not match.");
      authSession = creatingAccount
        ? await resolvedAuthClient.createAccount(byId("auth-email").value, password, { displayName: username })
        : await resolvedAuthClient.signIn(byId("auth-email").value, password);
      account = authSession.user;
      storageScope = `uid-${account.uid}`;
      loadProfileScope();
      selectedDogId = "";
      byId("auth-password").value = "";
      byId("auth-password-confirm").value = "";
      setAuthMode("signin");
      renderDogSelect();
      clearConversation("Signed in. A new dog/session context is active; no chat or profile data was uploaded.");
      refreshAccountUI();
      let accountSetupMessage = "";
      if (creatingAccount) {
        if (accountClient?.enabled === true) {
          try {
            const setup = await accountClient.syncAfterSignup({ username });
            accountSetupMessage = setup?.accessStatus === "active"
              ? " Academy account setup completed."
              : " Academy access is pending owner approval.";
          } catch (error) {
            accountSetupMessage = ` ${error.message}`;
          }
        } else {
          accountSetupMessage = " Academy account registration is not enabled here; hosted access remains pending.";
        }
      }
      byId("auth-status").textContent = `Signed in as ${account.email}. The session token stays in memory and is cleared on page close.${accountSetupMessage}`;
      renderSavedDogs();
    } catch (error) {
      byId("auth-password").value = "";
      byId("auth-password-confirm").value = "";
      status.textContent = error.message;
      byId("auth-submit").disabled = resolvedAuthClient.enabled !== true || !authConfigStatus(config?.firebase, config?.mode).configured;
    }
  });
  byId("auth-mode-signin").addEventListener("click", () => setAuthMode("signin"));
  byId("auth-mode-create").addEventListener("click", () => setAuthMode("create"));
  byId("auth-signout").addEventListener("click", async () => {
    try {
      await resolvedAuthClient.signOut();
    } catch {
      byId("auth-status").textContent = "Firebase could not sign out. The current account remains active in this tab.";
      return;
    }
    authSession = null;
    account = null;
    storageScope = "local-review";
    loadProfileScope();
    selectedDogId = "";
    renderDogSelect();
    clearConversation("Signed out. The local review profile context is active; no account token is stored.");
    refreshAccountUI();
    renderSavedDogs();
  });
  byId("privacy-open").addEventListener("click", () => byId("privacy-dialog").showModal());
  byId("review-info").addEventListener("click", () => byId("privacy-dialog").showModal());
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => byId(button.dataset.close).close()));
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));

  renderLibrary();
  renderDogSelect();
  refreshAccountUI();
  if (profileState.error) showProfileFeedback(profileState.error);

  return Object.freeze({
    search: searchIndex.search,
    get state() { return { user: account ? { uid: account.uid, email: account.email } : null, dogCount: profiles.length, selectedDogId, chatSaved: false, tokenSaved: false }; },
    _answer: (query) => buildAnswer({ query, records, hits: searchIndex.search(resolveQuery(query, lastQuery), 3), profile: activeProfile(), previousQuery: lastQuery })
  });
}
