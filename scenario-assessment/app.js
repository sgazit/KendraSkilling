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
async function fetchScenarios(passcode) {
  if (!CONFIG.APPS_SCRIPT_URL) {
    throw new Error("This app has not been connected to a data source yet (APPS_SCRIPT_URL is empty in app.js).");
  }

  const url = CONFIG.APPS_SCRIPT_URL + "?key=" + encodeURIComponent(passcode);
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
    throw new Error(data.error === "Invalid or missing passcode." ? "Incorrect passcode." : data.error);
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

// ── Screen router ──────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Welcome screen ─────────────────────────────────
function initWelcome() {
  const saved = loadState();
  if (saved) {
    state = saved;
    document.getElementById("input-name").value = state.name;
    document.getElementById("input-email").value = state.email;
    const notice = document.getElementById("resume-notice");
    const scenarioNum = state.currentScenario + 1;
    const questionNum = state.currentQuestion + 1;
    notice.innerHTML = `<strong>Welcome back!</strong> You have a saved session, pick up at Scenario ${scenarioNum} of 5, Question ${questionNum}.`;
    notice.classList.add("visible");
    document.getElementById("begin-label").textContent = "Resume Assessment →";
  }

  const keyFromUrl = getKeyFromUrl();
  const passcodeField = document.getElementById("field-passcode");
  const passcodeInput = document.getElementById("input-passcode");
  if (keyFromUrl) {
    passcodeField.style.display = "none";
    passcodeInput.value = keyFromUrl;
  }

  document.getElementById("btn-begin").addEventListener("click", handleBegin);

  // Enter key in any welcome-screen field starts the assessment, same as clicking the button.
  function trySubmitOnEnter(e) {
    if (e.key === "Enter" && !document.getElementById("btn-begin").disabled) handleBegin();
  }
  document.getElementById("input-name").addEventListener("keydown", trySubmitOnEnter);
  document.getElementById("input-email").addEventListener("keydown", trySubmitOnEnter);
  passcodeInput.addEventListener("keydown", trySubmitOnEnter);
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
      SCENARIOS = await fetchScenarios(passcode);
    } catch (err) {
      btn.disabled = false;
      label.textContent = resumeLabel;
      spinner.classList.remove("visible");
      errBox.textContent = err.message;
      errBox.classList.add("visible");
      return;
    }
  }

  state.name = name;
  state.email = email;
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  saveState();
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
    showScreen("screen-welcome");
  });

  renderQuestion(idx);
}

// ── Question renderer, one question at a time, no way back ──
function renderQuestion(idx) {
  advanceScheduled = false;
  const sc = SCENARIOS[idx];
  const qi = state.currentQuestion;
  const q = sc.questions[qi];

  const fillEl = document.getElementById("q-progress-fill");
  if (fillEl) fillEl.style.width = Math.round((qi / sc.questions.length) * 100) + "%";

  let optionsHtml = q.options.map((opt, oi) => {
    const letter = LETTERS[oi];
    return `
      <label class="option-label" data-qid="${q.id}" data-letter="${letter}" role="radio" aria-checked="false">
        <div class="option-letter">${letter}</div>
        <div class="option-text">${opt}</div>
      </label>`;
  }).join("");

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
    <span style="font-size:12px;color:var(--text-muted);line-height:1.5;">Choosing an answer moves you to the next question; there's no going back.</span>
    <button class="skip-btn" id="btn-skip" style="flex-shrink:0;">Skip, scores 0</button>`;

  // Bind option clicks
  document.querySelectorAll(`.option-label[data-qid="${q.id}"]`).forEach(label => {
    label.addEventListener("click", () => chooseAnswer(q.id, label.dataset.letter));
  });

  // Bind skip
  const skipBtn = document.getElementById("btn-skip");
  if (skipBtn) skipBtn.addEventListener("click", () => skipCurrentQuestion(q.id));
}

let advanceScheduled = false;

function chooseAnswer(qid, letter) {
  if (advanceScheduled || qid in state.answers) return; // guard against double-fire (e.g. label→input click forwarding)
  advanceScheduled = true;
  state.answers[qid] = letter;
  saveState();
  document.querySelectorAll(`.option-label[data-qid="${qid}"]`).forEach(l => {
    l.classList.toggle("selected", l.dataset.letter === letter);
    l.setAttribute("aria-checked", l.dataset.letter === letter ? "true" : "false");
  });
  const list = document.getElementById(`options-${qid}`);
  if (list) list.classList.add("locked");
  const skipBtn = document.getElementById("btn-skip");
  if (skipBtn) skipBtn.disabled = true;
  setTimeout(advanceFlow, 550);
}

function skipCurrentQuestion(qid) {
  if (advanceScheduled || qid in state.answers) return; // guard against double-fire
  advanceScheduled = true;
  state.answers[qid] = null;
  saveState();
  const list = document.getElementById(`options-${qid}`);
  if (list) list.classList.add("locked");
  const skipBtn = document.getElementById("btn-skip");
  if (skipBtn) { skipBtn.disabled = true; skipBtn.textContent = "Skipped"; }
  setTimeout(advanceFlow, 400);
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
    renderScenario(state.currentScenario);
    showScreen("screen-scenario");
  } else {
    renderReview();
    showScreen("screen-review");
  }
}

// ── Review screen ──────────────────────────────────
function renderReview() {
  document.getElementById("review-greeting").textContent = `Almost done, ${state.name}!`;

  let totalSkipped = 0;
  let listHtml = SCENARIOS.map(sc => {
    const answered = sc.questions.filter(q => state.answers[q.id] && state.answers[q.id] !== null).length;
    const skipped = sc.questions.filter(q => state.answers[q.id] === null).length;
    totalSkipped += skipped;
    const skippedNote = skipped > 0 ? ` <span style="color:var(--text-muted)">(${skipped} skipped)</span>` : "";
    return `
      <div class="review-scenario-row">
        <div>
          <div class="review-scenario-name">${sc.title}</div>
          <div class="review-scenario-count">${answered} / ${sc.questions.length} answered${skippedNote}</div>
        </div>
        <div class="review-check">✅</div>
      </div>`;
  }).join("");
  document.getElementById("review-scenarios-list").innerHTML = listHtml;

  document.getElementById("review-identity").innerHTML =
    `<strong>${state.name}</strong> &nbsp;·&nbsp; ${state.email}`;

  const warn = document.getElementById("review-skipped-warning");
  if (totalSkipped > 0) {
    warn.textContent = `⚠️  ${totalSkipped} question${totalSkipped > 1 ? 's were' : ' was'} skipped and will receive a score of 0.`;
    warn.classList.add("visible");
  } else {
    warn.classList.remove("visible");
  }

  document.getElementById("btn-submit").onclick = submitAssessment;
}

// ── Submission ─────────────────────────────────────
async function submitAssessment() {
  const btn = document.getElementById("btn-submit");
  const label = document.getElementById("submit-label");
  const spinner = document.getElementById("submit-spinner");
  const errBox = document.getElementById("submit-error");

  btn.disabled = true;
  label.textContent = "Submitting…";
  spinner.classList.add("visible");
  errBox.classList.remove("visible");

  // Build payload row
  const payload = {
    timestamp: new Date().toISOString(),
    name: state.name,
    email: state.email,
  };
  SCENARIOS.forEach(sc => {
    sc.questions.forEach(q => {
      payload[q.id] = state.answers[q.id] ?? "SKIPPED";
    });
  });

  try {
    await fetch(CONFIG.SUBMIT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // no-cors means we can't read response, assume success
    clearState();
    document.getElementById("thankyou-name").textContent = `Thank you, ${state.name}!`;
    showScreen("screen-thankyou");
    launchConfetti();
  } catch (err) {
    btn.disabled = false;
    label.textContent = "Submit Assessment";
    spinner.classList.remove("visible");
    errBox.classList.add("visible");
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
document.addEventListener("DOMContentLoaded", initWelcome);
