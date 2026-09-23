/**
 * Kendra Engineer Assessment — Sunny Bay Park variant — app.js
 *
 * Fork of the original Scenario Assessment's app.js. Same screen flow,
 * same localStorage save/resume pattern, same passcode-gated content fetch.
 * Differences are called out inline below; search "SUNNY BAY" to find them.
 *
 * The stages (context, questions, answer options) are NOT stored in this
 * file — they live in a private Apps Script backend and are fetched at
 * runtime, gated by a passcode. This keeps assessment content out of the
 * public GitHub repo. See SETUP.md.
 *
 * Submitted answers are POSTed to a second, separate Apps Script
 * deployment bound to its own "Sunny Bay Assessment Responses" Google
 * Sheet — deliberately NOT the original assessment's Sheet, since the two
 * variants' Q1..Q24 / Q1..Q25 columns mean different questions.
 */

'use strict';

/* ─────────────────────────────────────────
   CONFIG
   ───────────────────────────────────────── */

const CONFIG = {
  // Apps Script Web App URL that serves the Sunny Bay Park stage content
  // (this variant's Code.gs). Paste your deployment URL here.
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzHD0Licy8Qo7zVA0mfcbQwIxCnFQVqBba7dL1j1PYGJtzIGyWdllIknBdT2dXE/exec',

  // Apps Script Web App URL that receives completed submissions and
  // appends them as rows to the "Sunny Bay Assessment Responses" sheet's
  // "Responses" tab (deploy "Sunny Bay answers code.gs" on that Sheet).
  SUBMIT_URL: 'https://script.google.com/macros/s/AKfycbz7nAaR1dgrKulpDOeZpIggTE8R87YzHhYxOB_I8UQj8wWXhkXKJ8IEe31JjrAfmyCu/exec',

  // SUNNY BAY: one colour + emoji per stage (4, not 5) — same Focal Five
  // brand palette as the original app, just one fewer entry.
  STAGE_COLORS: ["#6422C9", "#2E7DF6", "#10B5A4", "#F7A93B"],
  STAGE_EMOJIS: ["🗺️", "🎢", "🛟", "🔧"],
};

/* ─────────────────────────────────────────
   DATA (fetched at runtime — see fetchStages)
   ───────────────────────────────────────── */

let STAGES = [];

const LETTERS = ["A", "B", "C", "D", "E"];
// SUNNY BAY: distinct storage key so this app's saved progress never
// collides with the original assessment's — both are served from the same
// github.io origin, and localStorage is shared per-origin, not per-folder.
const STORAGE_KEY = "eng_assessment_sunny_bay_v1";

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
 * Fetches the stage set from the Apps Script backend using the given
 * passcode. Throws with a user-facing message on any failure.
 */
async function fetchStages(passcode) {
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

  // The backend's response key is still "scenarios" (same content-server
  // pattern as the original Code.gs) — it holds this variant's stages.
  if (!Array.isArray(data.scenarios) || data.scenarios.length === 0) {
    throw new Error("No stages were returned. Check the backend configuration and try again.");
  }

  return data.scenarios;
}

/* ─────────────────────────────────────────
   State
   ───────────────────────────────────────── */

let state = {
  name: "",
  email: "",
  currentStage: 0,     // 0-indexed
  currentQuestion: 0,  // 0-indexed, within currentStage
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
        if (typeof saved.currentStage !== "number") saved.currentStage = 0;
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
    const stageNum = state.currentStage + 1;
    const questionNum = state.currentQuestion + 1;
    notice.innerHTML = `<strong>Welcome back!</strong> You have a saved session, pick up at Stage ${stageNum} of 4, Question ${questionNum}.`;
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

  if (STAGES.length === 0) {
    try {
      STAGES = await fetchStages(passcode);
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
  renderStage(state.currentStage);
  showScreen("screen-scenario");
}

/**
 * SUNNY BAY: resolves a raw image reference (relative path, bare filename,
 * or a Google Drive share link) into a usable <img> src, the same way the
 * original app resolved CONFIG.SCENARIO_IMAGES entries. No real artwork
 * exists yet — every question's `image` field is currently empty — but
 * this keeps a drop-in path ready: once images are added to the content
 * source, they show up here with no code change.
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveImageUrl(rawUrl) {
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) {
    let fileId = "";
    const matchView = rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const matchUc = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (matchView) fileId = matchView[1];
    else if (matchUc) fileId = matchUc[1];
    else fileId = rawUrl;
    return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200` : "";
  }
  return rawUrl;
}

/**
 * SUNNY BAY: builds the clickable image/placeholder block for one
 * question. Fixed size (matches .scenario-image / .scenario-image-placeholder
 * exactly) whether or not a real image exists, so the screen never reflows
 * once artwork is added. Clicking it opens the same image full-size in the
 * lightbox — real interactivity today, ready for richer behavior later.
 */
function renderQuestionImage(stage, question, stageColor, stageEmoji) {
  const imgUrl = resolveImageUrl(question.image);
  const altText = escapeHtml(question.text ? question.text.slice(0, 120) : stage.title);

  if (imgUrl) {
    return `
      <button type="button" class="question-image-btn" data-img="${escapeHtml(imgUrl)}" data-emoji="${stageEmoji}" style="--scenario-color:${stageColor};" aria-label="View larger image">
        <img class="scenario-image" src="${escapeHtml(imgUrl)}" alt="${altText}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div class="scenario-image-placeholder" style="display:none;">${stageEmoji}</div>
      </button>`;
  }
  return `
    <button type="button" class="question-image-btn" data-emoji="${stageEmoji}" style="--scenario-color:${stageColor};" aria-label="View larger image">
      <div class="scenario-image-placeholder">${stageEmoji}</div>
    </button>`;
}

function openImageLightbox(imgUrl, emoji, color) {
  const lightbox = document.getElementById("image-lightbox");
  const content = document.getElementById("image-lightbox-content");
  if (imgUrl) {
    content.innerHTML = `<img src="${imgUrl}" alt="">`;
  } else {
    content.innerHTML = `<div class="image-lightbox-placeholder" style="--scenario-color:${color};">${emoji}</div>`;
  }
  lightbox.classList.add("visible");
  lightbox.setAttribute("aria-hidden", "false");
}
function closeImageLightbox() {
  const lightbox = document.getElementById("image-lightbox");
  lightbox.classList.remove("visible");
  lightbox.setAttribute("aria-hidden", "true");
}

// ── Stage renderer (context card + shell; called once per stage) ──
function renderStage(idx) {
  const stage = STAGES[idx];
  const container = document.getElementById("screen-scenario");
  const stageColor = CONFIG.STAGE_COLORS[idx] || "var(--k-purple)";

  // Progress dots
  let dotsHtml = STAGES.map((_, i) => {
    let cls = "dot";
    if (i < idx) cls += " completed";
    else if (i === idx) cls += " current";
    return `<div class="${cls}"></div>`;
  }).join("");

  container.innerHTML = `
    <div class="scenario-topbar">
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="progress-dots">${dotsHtml}</div>
        <div class="scenario-label">Stage ${idx + 1} of ${STAGES.length}</div>
      </div>
      <button class="save-exit-btn" id="btn-save-exit">Save &amp; exit</button>
    </div>

    <div class="card" style="--scenario-color:${stageColor};">
      <div class="scenario-title">${stage.title}</div>
      <div class="scenario-context">${stage.context}</div>
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
  const stage = STAGES[idx];
  const qi = state.currentQuestion;
  const q = stage.questions[qi];
  const stageColor = CONFIG.STAGE_COLORS[idx] || "var(--k-purple)";
  const stageEmoji = CONFIG.STAGE_EMOJIS[idx] || "🎡";

  const fillEl = document.getElementById("q-progress-fill");
  if (fillEl) fillEl.style.width = Math.round((qi / stage.questions.length) * 100) + "%";

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
      ${renderQuestionImage(stage, q, stageColor, stageEmoji)}
      <div class="question-header">
        <div>
          <div class="question-number">Question ${qi + 1} of ${stage.questions.length}</div>
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

  // Bind image click -> lightbox
  const imgBtn = document.querySelector(`#qblock-${q.id} .question-image-btn`);
  if (imgBtn) {
    imgBtn.addEventListener("click", () => {
      openImageLightbox(imgBtn.dataset.img || "", imgBtn.dataset.emoji || "", stageColor);
    });
  }
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

// ── Advance, forward only, one question/stage at a time ──
function advanceFlow() {
  const stage = STAGES[state.currentStage];
  if (state.currentQuestion < stage.questions.length - 1) {
    state.currentQuestion++;
    saveState();
    renderQuestion(state.currentStage);
  } else if (state.currentStage < STAGES.length - 1) {
    state.currentStage++;
    state.currentQuestion = 0;
    saveState();
    renderStage(state.currentStage);
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
  let listHtml = STAGES.map(stage => {
    const answered = stage.questions.filter(q => state.answers[q.id] && state.answers[q.id] !== null).length;
    const skipped = stage.questions.filter(q => state.answers[q.id] === null).length;
    totalSkipped += skipped;
    const skippedNote = skipped > 0 ? ` <span style="color:var(--text-muted)">(${skipped} skipped)</span>` : "";
    return `
      <div class="review-scenario-row">
        <div>
          <div class="review-scenario-name">${stage.title}</div>
          <div class="review-scenario-count">${answered} / ${stage.questions.length} answered${skippedNote}</div>
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
  STAGES.forEach(stage => {
    stage.questions.forEach(q => {
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
  const colors = CONFIG.STAGE_COLORS;
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
document.addEventListener("DOMContentLoaded", () => {
  initWelcome();
  const lightbox = document.getElementById("image-lightbox");
  if (lightbox) lightbox.addEventListener("click", closeImageLightbox);
});
