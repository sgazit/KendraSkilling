/**
 * Kendra Engineer Assessment — app.js
 *
 * The five scenarios (context, questions, answer options) are NOT stored
 * in this file — they live in a private Apps Script backend and are
 * fetched at runtime, gated by a passcode. This keeps the assessment
 * content out of the public GitHub repo. See SETUP.md.
 *
 * Submitted answers are POSTed to a second, separate Apps Script
 * deployment bound to the "Engineer Assessment Responses" Google Sheet.
 */

'use strict';

/* ─────────────────────────────────────────
   CONFIG
   ───────────────────────────────────────── */

const CONFIG = {
  // Apps Script Web App URL that serves the scenario content (Code.gs).
  // Paste your deployment URL here (see SETUP.md, step 3).
  // Looks like: https://script.google.com/macros/s/AKfycb.../exec
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyyeMrmF_15UZhwGKQo3r2ZqoZ-h-4xTromPZuR0EAi-35MfEv3PTysyIyQNGVBpkLzDw/exec',

  // Apps Script Web App URL that receives completed submissions and
  // appends them as rows to the "Engineer Assessment Responses" sheet's
  // "Responses" tab (deploy "Scenario Assessment answers code.gs" on
  // that Sheet — see SETUP.md).
  SUBMIT_URL: 'https://script.google.com/macros/s/AKfycbxaO4rGHSNYoEbL_5BJmBt9b8DTPfST6GbDmwsyPXiB0LfvGq5lRR1f6k8rzMCRAz3A/exec',

  // Scenario images bundled as static assets with this frontend.
  SCENARIO_IMAGES: [
    "scenario-images/Storm_Volunteer1.jpg",
    "scenario-images/Payments_Platform1.jpg",
    "scenario-images/Public_Library1.jpg",
    "scenario-images/AI_Feature_Launch1.jpg",
    "scenario-images/Community_Food_Pantry1.jpg",
  ],

  // Scenario image fallback emojis (shown if image URL is empty or fails)
  SCENARIO_EMOJIS: ["⛈️", "💳", "📚", "🤖", "🥦"],

  // Kendra "Focal Five" brand colours, one per scenario, in order.
  SCENARIO_COLORS: ["#6422C9", "#2E7DF6", "#10B5A4", "#F7A93B", "#F2547D"],
};

/* ─────────────────────────────────────────
   DATA (fetched at runtime — see fetchScenarios)
   ───────────────────────────────────────── */

let SCENARIOS = [];

const LETTERS = ["A", "B", "C", "D", "E"];
const STORAGE_KEY = "eng_assessment_v1";

/* ─────────────────────────────────────────
   REMOTE DATA FETCH
   ───────────────────────────────────────── */

/** Reads ?key=... from the current URL, if present. */
function getKeyFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("key") || "";
  } catch (err) {
    return "";
  }
}

/**
 * Fetches the scenario set from the Apps Script backend using the given
 * passcode. Throws with a user-facing message on any failure.
 */
async function fetchScenarios(email, passcode) {
  if (!CONFIG.APPS_SCRIPT_URL) {
    throw new Error("This app has not been connected to a data source yet (APPS_SCRIPT_URL is empty in app.js).");
  }

  const url = CONFIG.APPS_SCRIPT_URL + "?email=" + encodeURIComponent(email) +
    "&password=" + encodeURIComponent(passcode);
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error("Could not reach the assessment data source. Check your connection and try again.");
  }

  if (!res.ok) {
    throw new Error("Assessment data source returned an error (" + res.status + ").");
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error("Assessment data source returned an unexpected response.");
  }

  if (data.error) {
    throw new Error(data.error);
  }

  if (!Array.isArray(data.scenarios) || data.scenarios.length === 0) {
    throw new Error("No scenarios were returned. Check the backend configuration and try again.");
  }

  return data.scenarios;
}

/* ─────────────────────────────────────────
   State
   ───────────────────────────────────────── */

let state = {
  name: "",
  email: "",
  currentScenario: 0,   // 0-indexed
  currentQuestion: 0,   // 0-indexed, within currentScenario
  answers: {},          // { "Q1": "A", "Q3": null (skipped), ... }
  startedAt: null,
  ndaApprovedAt: null,  // ISO time the NDA box was ticked (first approval is kept)
};

// ── Persistence ────────────────────────────────────
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && saved.name) {
        if (typeof saved.currentQuestion !== "number") saved.currentQuestion = 0;
        return saved;
      }
    }
  } catch (e) { }
  return null;
}
function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Progress (server-side copy, see kendra-progress.js) ──
let submitted = false;

function reportProgress(status) {
  const login = KendraSession.get();
  if (!login || !state.name) return Promise.resolve(false);
  return KendraProgress.save(CONFIG.SUBMIT_URL, login.passcode, {
    name:          state.name,
    email:         state.email,
    status:        status || "in_progress",
    answered:      Object.keys(state.answers).length,
    total:         SCENARIOS.reduce((n, sc) => n + sc.questions.length, 0),
    startedAt:     state.startedAt,
    ndaApprovedAt: state.ndaApprovedAt || "",
    state: {
      answers:         state.answers,
      currentScenario: state.currentScenario,
      currentQuestion: state.currentQuestion,
    },
  });
}

// Merges the server copy into this browser's state so the two line up even if the last save
// to either side was lost. Answers are combined by question; where both sides answered the
// same question, the copy that is further along wins. The caller saves the result to both.
function mergeRemoteProgress(remote) {
  if (!remote || remote.status !== "in_progress" || !remote.state || !remote.state.answers) return;
  const rs = remote.state;
  const localAnswered = Object.keys(state.answers).length;
  const remoteAhead = Object.keys(rs.answers).length > localAnswered;

  state.answers = remoteAhead
    ? Object.assign({}, state.answers, rs.answers)
    : Object.assign({}, rs.answers, state.answers);

  const localPos  = state.currentScenario * 1000 + state.currentQuestion;
  const remotePos = (rs.currentScenario || 0) * 1000 + (rs.currentQuestion || 0);
  if (remotePos > localPos) {
    state.currentScenario = rs.currentScenario || 0;
    state.currentQuestion = rs.currentQuestion || 0;
  }
  if (!state.startedAt && remote.startedAt) state.startedAt = remote.startedAt;
}

// ── Screen router ──────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Welcome screen ─────────────────────────────────
function initWelcome() {
  const login = KendraSession.get();
  if (!login) {
    location.replace("../");
    return;
  }

  const saved = loadState();
  if (saved) {
    state = saved;
    const notice = document.getElementById("resume-notice");
    const scenarioNum = state.currentScenario + 1;
    const questionNum = state.currentQuestion + 1;
    notice.innerHTML = `<strong>Welcome back!</strong> You have a saved session, pick up at Scenario ${scenarioNum} of 5, Question ${questionNum}.`;
    notice.classList.add("visible");
    document.getElementById("begin-label").textContent = "Resume Assessment →";
  }

  // Identity, passcode and NDA were collected on the hub; the form fields stay in
  // the DOM (handleBegin reads them) but are hidden.
  document.getElementById("input-name").value = login.name;
  document.getElementById("input-email").value = login.email;
  document.getElementById("input-passcode").value = login.passcode;
  document.getElementById("input-nda").checked = true;
  document.querySelectorAll("#screen-welcome .field, #screen-welcome .nda-check").forEach(el => {
    el.style.display = "none";
  });
  if (!state.ndaApprovedAt) state.ndaApprovedAt = login.ndaApprovedAt;

  document.getElementById("btn-begin").addEventListener("click", handleBegin);
}

async function handleBegin() {
  const name = document.getElementById("input-name").value.trim();
  const email = document.getElementById("input-email").value.trim();
  const passcode = document.getElementById("input-passcode").value.trim();
  const passcodeVisible = document.getElementById("field-passcode").style.display !== "none";
  let valid = true;

  if (!name) {
    document.getElementById("error-name").classList.add("visible");
    document.getElementById("input-name").classList.add("error");
    valid = false;
  } else {
    document.getElementById("error-name").classList.remove("visible");
    document.getElementById("input-name").classList.remove("error");
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRe.test(email)) {
    document.getElementById("error-email").classList.add("visible");
    document.getElementById("input-email").classList.add("error");
    valid = false;
  } else {
    document.getElementById("error-email").classList.remove("visible");
    document.getElementById("input-email").classList.remove("error");
  }
  if (passcodeVisible && !passcode) {
    document.getElementById("error-passcode").classList.add("visible");
    document.getElementById("input-passcode").classList.add("error");
    valid = false;
  } else {
    document.getElementById("error-passcode").classList.remove("visible");
    document.getElementById("input-passcode").classList.remove("error");
  }
  if (!document.getElementById("input-nda").checked) {
    document.getElementById("error-nda").classList.add("visible");
    valid = false;
  } else {
    document.getElementById("error-nda").classList.remove("visible");
  }
  if (!valid) return;

  const btn = document.getElementById("btn-begin");
  const label = document.getElementById("begin-label");
  const spinner = document.getElementById("begin-spinner");
  const errBox = document.getElementById("load-error");
  const resumeLabel = state.name ? "Resume Assessment →" : "Begin Assessment →";

  btn.disabled = true;
  label.textContent = "Loading…";
  spinner.classList.add("visible");
  errBox.classList.remove("visible");

  if (SCENARIOS.length === 0) {
    try {
      SCENARIOS = await fetchScenarios(email, passcode);
    } catch (err) {
      // The hub accepted this passcode, so a failure here means it is stale or the
      // backend is unreachable. Show the reason, and make sure the next visit to the hub re-asks.
      KendraSession.clear();
      btn.disabled = false;
      label.textContent = resumeLabel;
      spinner.classList.remove("visible");
      errBox.innerHTML = "";
      errBox.append(err.message + " ");
      const back = document.createElement("a");
      back.href = "../";
      back.textContent = "Back to sign in";
      errBox.append(back);
      errBox.classList.add("visible");
      return;
    }
  }

  state.name = name;
  state.email = email;
  mergeRemoteProgress(await KendraProgress.load(CONFIG.SUBMIT_URL, passcode, email));
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  if (!state.ndaApprovedAt) state.ndaApprovedAt = new Date().toISOString();
  saveState();
  reportProgress();
  // Everything already answered (e.g. the page was reloaded while saving): go straight to saving.
  if (SCENARIOS.every(u => u.questions.every(q => q.id in state.answers))) {
    finishAssessment();
    return;
  }
  renderScenario(state.currentScenario);
  showScreen("screen-scenario");
}

// ── Scenario renderer (context card + shell; called once per scenario) ──
function renderScenario(idx) {
  const sc = SCENARIOS[idx];
  const container = document.getElementById("screen-scenario");
  const scenarioColor = CONFIG.SCENARIO_COLORS[idx] || "var(--k-purple)";

  // Progress dots
  let dotsHtml = SCENARIOS.map((_, i) => {
    let cls = "dot";
    if (i < idx) cls += " completed";
    else if (i === idx) cls += " current";
    return `<div class="${cls}"></div>`;
  }).join("");

  // Image or emoji fallback
  let rawUrl = CONFIG.SCENARIO_IMAGES[idx] || "";
  let imgUrl = "";
  if (rawUrl) {
    if (/^https?:\/\//i.test(rawUrl)) {
      let fileId = "";
      const matchView = rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      const matchUc = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (matchView) fileId = matchView[1];
      else if (matchUc) fileId = matchUc[1];
      else fileId = rawUrl;
      if (fileId) imgUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`;
    } else {
      imgUrl = rawUrl;
    }
  }

  let imageHtml;
  if (imgUrl) {
    imageHtml = `<img class="scenario-image" src="${imgUrl}" alt="${sc.title}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
    <div class="scenario-image-placeholder" style="display:none;">${CONFIG.SCENARIO_EMOJIS[idx]}</div>`;
  } else {
    imageHtml = `<div class="scenario-image-placeholder">${CONFIG.SCENARIO_EMOJIS[idx]}</div>`;
  }

  container.innerHTML = `
    <div class="scenario-topbar">
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="progress-dots">${dotsHtml}</div>
        <div class="scenario-label">Scenario ${idx + 1} of ${SCENARIOS.length}</div>
      </div>
      <button class="save-exit-btn" id="btn-save-exit">Save &amp; exit</button>
    </div>

    <div class="card" style="--scenario-color:${scenarioColor};">
      ${imageHtml}
      <div class="scenario-title">${sc.title}</div>
      <div class="scenario-context">${sc.context}</div>
    </div>

    <div class="card">
      <div class="q-progress-track"><div class="q-progress-fill" id="q-progress-fill" style="width:0%"></div></div>
      <div class="questions-section" id="questions-section"></div>
      <div class="scenario-nav" id="scenario-nav"></div>
    </div>`;

  document.getElementById("btn-save-exit").addEventListener("click", () => {
    saveState();
    reportProgress();
    location.href = "../";
  });

  renderQuestion(idx);
}

// ── Question renderer, one question at a time, no way back ──
function renderQuestion(idx) {
  advanceScheduled = false;
  pendingChoice = null;
  const sc = SCENARIOS[idx];
  const qi = state.currentQuestion;
  const q = sc.questions[qi];

  const fillEl = document.getElementById("q-progress-fill");
  if (fillEl) fillEl.style.width = Math.round((qi / sc.questions.length) * 100) + "%";

  let optionsHtml = q.options.map((opt, oi) => {
    const letter = LETTERS[oi];
    return `
      <label class="option-label" data-qid="${q.id}" data-letter="${letter}" role="radio" aria-checked="false" tabindex="0">
        <div class="option-letter">${letter}</div>
        <div class="option-text">${opt}</div>
      </label>`;
  }).join("");

  // Last option: skipping, which scores 0
  optionsHtml += `
      <label class="option-label option-skip" data-qid="${q.id}" data-letter="${SKIP_CHOICE}" role="radio" aria-checked="false" tabindex="0">
        <div class="option-letter">S</div>
        <div class="option-text">Skip (Scores 0)</div>
      </label>`;

  document.getElementById("questions-section").innerHTML = `
    <div class="question-block" id="qblock-${q.id}">
      <div class="question-header">
        <div>
          <div class="question-number">Question ${qi + 1} of ${sc.questions.length}</div>
          <div class="question-text">${q.text}</div>
        </div>
      </div>
      <div class="options-list" id="options-${q.id}">
        ${optionsHtml}
      </div>
    </div>`;

  document.getElementById("scenario-nav").innerHTML = `
    <span style="font-size:12px;color:var(--text-muted);line-height:1.5;">Choose an answer (click, or press its letter; S to skip), then click Next or press Enter. Once you move on there's no going back.</span>
    <button class="btn btn-primary next-btn" id="btn-next" style="flex-shrink:0;" disabled>Next</button>`;

  // Bind option clicks: they only select; Next commits
  document.querySelectorAll(`.option-label[data-qid="${q.id}"]`).forEach(label => {
    label.addEventListener("click", () => selectOption(q.id, label.dataset.letter));
  });

  document.getElementById("btn-next").addEventListener("click", () => onNext(q.id));
}

const SKIP_CHOICE = "S";
let advanceScheduled = false;
let pendingChoice = null; // letter (or SKIP_CHOICE) highlighted on the current question, not yet committed

function selectOption(qid, letter) {
  if (advanceScheduled || qid in state.answers) return;
  pendingChoice = letter;
  document.querySelectorAll(`.option-label[data-qid="${qid}"]`).forEach(l => {
    l.classList.toggle("selected", l.dataset.letter === letter);
    l.setAttribute("aria-checked", l.dataset.letter === letter ? "true" : "false");
  });
  const nextBtn = document.getElementById("btn-next");
  if (nextBtn) nextBtn.disabled = false;
}

// ── Keyboard: letter = choose, S = skip, Up/Down = move choice, Enter = Next ──
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.getElementById("skip-modal")) return; // the confirm box handles its own keys
  const screen = document.getElementById("screen-scenario");
  if (!screen || !screen.classList.contains("active")) return;
  const labels = Array.from(document.querySelectorAll("#questions-section .option-label"));
  if (!labels.length) return;
  const t = e.target;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  const qid = labels[0].dataset.qid;
  const pick = (label) => { if (label) { selectOption(qid, label.dataset.letter); label.focus(); } };
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

  const byLetter = labels.find(l => l.dataset.letter === key);
  if (byLetter) { e.preventDefault(); pick(byLetter); return; }

  if (key === "ArrowDown" || key === "ArrowUp") {
    e.preventDefault();
    const cur = labels.findIndex(l => l.dataset.letter === pendingChoice);
    const step = key === "ArrowDown" ? 1 : -1;
    pick(labels[cur === -1 ? (step === 1 ? 0 : labels.length - 1) : (cur + step + labels.length) % labels.length]);
    return;
  }

  if (key === " " && t && t.classList && t.classList.contains("option-label")) {
    e.preventDefault();
    pick(t);
    return;
  }

  // Enter = Next. A focused button handles Enter itself (it fires a click), so don't double up.
  if (key === "Enter" && !(t && t.tagName === "BUTTON")) {
    e.preventDefault();
    onNext(qid);
  }
});

function onNext(qid) {
  if (advanceScheduled || qid in state.answers || !pendingChoice) return;
  if (pendingChoice === SKIP_CHOICE) {
    showSkipConfirm(() => commitAnswer(qid, null));
  } else {
    commitAnswer(qid, pendingChoice);
  }
}

function commitAnswer(qid, value) {
  if (advanceScheduled || qid in state.answers) return; // guard against double-fire
  advanceScheduled = true;
  state.answers[qid] = value; // null = skipped
  saveState();
  const list = document.getElementById(`options-${qid}`);
  if (list) list.classList.add("locked");
  const nextBtn = document.getElementById("btn-next");
  if (nextBtn) nextBtn.disabled = true;
  advanceFlow();
}

// Branded confirm dialog (native confirm() shows the site's hostname as its title)
function showSkipConfirm(onConfirm) {
  if (document.getElementById("skip-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "skip-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="skip-modal-title" aria-describedby="skip-modal-msg">
      <h3 id="skip-modal-title">Kendra Skilling says</h3>
      <p id="skip-modal-msg">Are you sure you want to skip this question?<br>You will not be able to go back</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="skip-modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="skip-modal-ok">OK</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  document.getElementById("skip-modal-cancel").addEventListener("click", close);
  document.getElementById("skip-modal-ok").addEventListener("click", () => { close(); onConfirm(); });
  document.getElementById("skip-modal-ok").focus();
}

// ── Advance, forward only, one question/scenario at a time ──
function advanceFlow() {
  const sc = SCENARIOS[state.currentScenario];
  if (state.currentQuestion < sc.questions.length - 1) {
    state.currentQuestion++;
    saveState();
    renderQuestion(state.currentScenario);
  } else if (state.currentScenario < SCENARIOS.length - 1) {
    state.currentScenario++;
    state.currentQuestion = 0;
    saveState();
    reportProgress();
    renderScenario(state.currentScenario);
    showScreen("screen-scenario");
  } else {
    reportProgress();
    finishAssessment();
  }
}

// ── Submission ─────────────────────────────────────
// Called after the last answer: shows the closing screen straight away and saves in the background.
function finishAssessment() {
  document.getElementById("thankyou-name").textContent = `Thank you, ${state.name}!`;
  document.getElementById("btn-done").style.display = "none";
  showScreen("screen-thankyou");
  setSaveIndicator("saving");
  submitAssessment();
}

function setSaveIndicator(status) {
  const el = document.getElementById("save-indicator");
  if (status === "saved") {
    el.className = "saved-indicator";
    el.innerHTML = "✓ Your answers have been saved.";
  } else if (status === "error") {
    el.className = "saved-indicator saved-indicator-error";
    el.innerHTML = "Couldn't save your answers. <button class=\"saved-retry-btn\" id=\"btn-retry-save\">Retry</button>";
    document.getElementById("btn-retry-save").onclick = () => { setSaveIndicator("saving"); submitAssessment(); };
  } else {
    el.className = "saved-indicator saved-indicator-pending";
    el.innerHTML = '<span class="saved-spinner"></span>Saving your answers…';
  }
}

async function submitAssessment() {
  // Build payload row
  const payload = {
    timestamp: new Date().toISOString(),
    name: state.name,
    email: state.email,
  };
  SCENARIOS.forEach(unit => {
    unit.questions.forEach(q => {
      payload[q.id] = state.answers[q.id] ?? "SKIPPED";
    });
  });
  // Added last so existing column order is untouched; sheet column is optional.
  payload.ndaApprovedAt = state.ndaApprovedAt || "";
  // Checked by the receiver, never stored in the sheet.
  payload.password = (KendraSession.get() || {}).passcode || "";

  try {
    await fetch(CONFIG.SUBMIT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // no-cors means we can't read response, assume success
    submitted = true;
    reportProgress("completed").then(ok => { if (!ok) reportProgress("completed"); });
    clearState();
    setSaveIndicator("saved");
    document.getElementById("btn-done").style.display = "";
    launchConfetti();
  } catch (err) {
    setSaveIndicator("error");
  }
}

// ── Confetti (Focal Five colours) ──────────────────
function launchConfetti() {
  const field = document.getElementById("confetti-field");
  if (!field || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  field.innerHTML = "";
  const colors = CONFIG.SCENARIO_COLORS;
  const pieces = 46;
  for (let i = 0; i < pieces; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    const color = colors[i % colors.length];
    const left = Math.random() * 100;
    const delay = Math.random() * 0.35;
    const duration = 1.4 + Math.random() * 0.9;
    const size = 6 + Math.random() * 5;
    const round = Math.random() > 0.5;
    el.style.left = `${left}%`;
    el.style.background = color;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = round ? "50%" : "2px";
    el.style.animationDelay = `${delay}s`;
    el.style.animationDuration = `${duration}s`;
    field.appendChild(el);
  }
  setTimeout(() => { field.innerHTML = ""; }, 2600);
}

// ── Boot ───────────────────────────────────────────
// Closing the tab mid-assessment: send what we have (keepalive lets it finish).
window.addEventListener("pagehide", () => {
  if (!submitted && SCENARIOS.length > 0 && Object.keys(state.answers).length > 0) reportProgress();
});

document.addEventListener("DOMContentLoaded", initWelcome);
