/**
 * SWE Skills Assessment — app.js
 *
 * Architecture: single-file vanilla JS, no dependencies.
 * State is a plain object; every mutation calls render().
 * Progress persists to localStorage keyed by (lowercased) user name.
 *
 * The assessment statements are NOT stored in this file — they live in
 * a private Google Sheet and are fetched at runtime from an Apps Script
 * endpoint, gated by a passcode. This keeps the confidential question
 * content out of the public GitHub repo. See SETUP.md.
 *
 * Question ordering: deterministic seeded shuffle per user name,
 * so the same person always sees the same random order across sessions.
 */

'use strict';

/* ─────────────────────────────────────────
   CONFIG
   ───────────────────────────────────────── */

const CONFIG = {
  // Paste your Apps Script Web App URL here (see SETUP.md, step 4).
  // Looks like: https://script.google.com/macros/s/AKfycb.../exec
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbx0_yl9m3wZU8joyC1Q82nHS1Gt9YozaLYHbR16JOzm_K5aRpdPW4qSPQH02UxCz1YR/exec',

  // Web App URL for the *separate* Apps Script deployment that receives
  // completed submissions and appends them to the Responses sheet — deploy
  // "Self Assessment answers code.gs" on the Responses Google Sheet and
  // paste its /exec URL here (see SETUP.md, "Submitting results").
  SUBMIT_URL: 'https://script.google.com/macros/s/AKfycbyKFFcZ0jacQz80A9gFRxJcMQHT9oWj64-b11_a2Wt1HUiNSffln-zzQ_AuvCkWSKyF/exec',
};

/* ─────────────────────────────────────────
   DATA (fetched at runtime — see fetchQuestions)
   ───────────────────────────────────────── */

let QUESTIONS = [];
let TOTAL = 0;

/** Kendra "Focal Pentagon" brand mark, inline so no external asset is needed. */
const KENDRA_LOGO_SVG =
  '<svg width="34" height="34" viewBox="0 0 200 200" aria-hidden="true">' +
    '<path d="M100 100 L51.8 33.7 L148.2 33.7 Z" fill="#6422C9"/>' +
    '<path d="M100 100 L148.2 33.7 L178 125.3 Z" fill="#2E7DF6"/>' +
    '<path d="M100 100 L178 125.3 L100 182 Z" fill="#10B5A4"/>' +
    '<path d="M100 100 L100 182 L22 125.3 Z" fill="#F7A93B"/>' +
    '<path d="M100 100 L22 125.3 L51.8 33.7 Z" fill="#F2547D"/>' +
    '<g stroke="#fff" stroke-width="4.5" stroke-linecap="round">' +
      '<line x1="100" y1="100" x2="51.8" y2="33.7"/>' +
      '<line x1="100" y1="100" x2="148.2" y2="33.7"/>' +
      '<line x1="100" y1="100" x2="178" y2="125.3"/>' +
      '<line x1="100" y1="100" x2="100" y2="182"/>' +
      '<line x1="100" y1="100" x2="22" y2="125.3"/>' +
    '</g>' +
    '<circle cx="100" cy="100" r="12" fill="#fff"/>' +
    '<circle cx="100" cy="100" r="6" fill="#6422C9"/>' +
  '</svg>';

const LIKERT_OPTIONS = [
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree'          },
  { value: 3, label: 'Neutral'           },
  { value: 4, label: 'Agree'             },
  { value: 5, label: 'Strongly agree'    },
];

/* ─────────────────────────────────────────
   REMOTE DATA FETCH
   ───────────────────────────────────────── */

/** Reads ?key=... from the current URL, if present. */
function getKeyFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('key') || '';
  } catch (err) {
    return '';
  }
}

/**
 * Fetches the question set from the Apps Script backend using the given
 * passcode. Throws with a user-facing message on any failure.
 */
async function fetchQuestions(passcode) {
  if (!CONFIG.APPS_SCRIPT_URL) {
    throw new Error('This app has not been connected to a data source yet (APPS_SCRIPT_URL is empty in app.js).');
  }

  const url = CONFIG.APPS_SCRIPT_URL + '?key=' + encodeURIComponent(passcode);
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error('Could not reach the assessment data source. Check your connection and try again.');
  }

  if (!res.ok) {
    throw new Error('Assessment data source returned an error (' + res.status + ').');
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error('Assessment data source returned an unexpected response.');
  }

  if (data.error) {
    throw new Error(data.error === 'Invalid or missing passcode.' ? 'Incorrect passcode.' : data.error);
  }

  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error('No questions were returned. Check the Sheet has data and try again.');
  }

  return data.questions;
}

/**
 * Submits a completed session to the Apps Script backend so it lands as a
 * row in the Responses sheet (read by score_assessment_v1.py downstream).
 * Throws with a user-facing message on any failure.
 */
async function submitResults(session) {
  if (!CONFIG.SUBMIT_URL) {
    throw new Error('Submission endpoint is not configured yet (SUBMIT_URL is empty in app.js).');
  }

  const answers = session.order.map(function (qId) {
    const q = QUESTIONS.find(function (x) { return x.id === qId; });
    return {
      questionId:   qId,
      questionText: q ? q.text  : '',
      skill:        q ? q.skill : '',
      type:         q ? q.type  : '',
      answer:       session.answers[qId],
    };
  });

  const payload = {
    name:        session.name,
    email:       session.email,
    startedAt:   session.startedAt,
    completedAt: session.completedAt,
    answers:     answers,
  };

  let res;
  try {
    // Content-Type text/plain keeps this a CORS "simple request" so the
    // browser doesn't issue a preflight OPTIONS call Apps Script can't answer.
    res = await fetch(CONFIG.SUBMIT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body:    JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error('Could not reach the submission endpoint. Check your connection and try again.');
  }

  if (!res.ok) {
    throw new Error('Submission endpoint returned an error (' + res.status + ').');
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error('Submission endpoint returned an unexpected response.');
  }

  if (data.error) {
    throw new Error(data.error);
  }
}

/* ─────────────────────────────────────────
   UTILITIES
   ───────────────────────────────────────── */

/**
 * Deterministic seeded RNG (mulberry32).
 * Same seed → same sequence every time.
 */
function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle using seeded RNG. */
function seededShuffle(arr, seed) {
  const result = arr.slice();
  const rng = seededRng(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/** Convert a name string to a reproducible 32-bit integer seed. */
function nameToSeed(name) {
  const s = name.toLowerCase().trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Escape HTML special characters for safe innerHTML insertion. */
function esc(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/* ─────────────────────────────────────────
   STORAGE
   ───────────────────────────────────────── */

const STORAGE_PREFIX = 'kendra_swe__';

function storageKey(name) {
  return STORAGE_PREFIX + name.toLowerCase().trim();
}

function saveSession(session) {
  try {
    localStorage.setItem(storageKey(session.name), JSON.stringify(session));
    return true;
  } catch (err) {
    console.error('[SWE] Failed to save session:', err);
    return false;
  }
}

function loadSession(name) {
  try {
    const raw = localStorage.getItem(storageKey(name));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

/* ─────────────────────────────────────────
   SESSION FACTORY
   ───────────────────────────────────────── */

/**
 * Creates a fresh session for a given name.
 * The question order is seeded by name so it's consistent
 * across devices for the same user but different from others.
 */
function createSession(name, email) {
  const seed  = nameToSeed(name);
  const order = seededShuffle(QUESTIONS.map(function (q) { return q.id; }), seed);
  return {
    name:        name.trim(),
    email:       (email || '').trim(),
    order:       order,       // array of question IDs in shuffled order
    answers:     {},          // { questionId: likertValue }
    currentIdx:  0,           // index into `order`
    complete:    false,
    startedAt:   new Date().toISOString(),
    completedAt: null,
    version:     1,           // schema version for future migrations
  };
}

/* ─────────────────────────────────────────
   APP STATE
   ───────────────────────────────────────── */

/**
 * Screens: 'login' | 'loading' | 'resume' | 'question' | 'complete'
 */
let state = {
  screen:          'login',
  session:         null,
  selectedValue:   null,   // currently highlighted Likert option
  showValidation:  false,  // show "please select" hint
  pendingName:     '',
  pendingEmail:    '',
  pendingPasscode: getKeyFromUrl(),
  loadError:       null,
  submitStatus:    null,   // null | 'saving' | 'saved' | 'error'
  submitErrorMsg:  null,
};

function setState(updates) {
  Object.assign(state, updates);
  render();
}

/* ─────────────────────────────────────────
   TOAST
   ───────────────────────────────────────── */

let toastTimer = null;

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.classList.remove('show');
  }, 2800);
}

/* ─────────────────────────────────────────
   ACTION HANDLERS
   ───────────────────────────────────────── */

async function handleLoginSubmit(rawName, rawEmail, rawPasscode) {
  const name     = rawName.trim();
  const email    = (rawEmail || '').trim();
  const passcode = (rawPasscode || '').trim();
  if (!name || !email || !passcode) return;

  setState({ screen: 'loading', pendingName: name, pendingEmail: email, pendingPasscode: passcode, loadError: null });

  if (QUESTIONS.length === 0) {
    try {
      const questions = await fetchQuestions(passcode);
      QUESTIONS = questions;
      TOTAL = QUESTIONS.length;
    } catch (err) {
      setState({ screen: 'login', loadError: err.message });
      return;
    }
  }

  const existing = loadSession(name);

  if (existing && !existing.complete) {
    // Resume prompt
    setState({ screen: 'resume', session: Object.assign({}, existing, { email: email }), loadError: null });
  } else {
    // Fresh start (or previous attempt was complete)
    const session = createSession(name, email);
    saveSession(session);
    setState({ screen: 'question', session: session, selectedValue: null, showValidation: false, loadError: null });
  }
}

function handleResume() {
  setState({ screen: 'question', selectedValue: null, showValidation: false });
}

function handleRestart() {
  const session = createSession(state.session.name, state.session.email);
  saveSession(session);
  setState({ screen: 'question', session: session, selectedValue: null, showValidation: false });
}

function handleSelectOption(value) {
  setState({ selectedValue: value, showValidation: false });
}

function handleNext() {
  if (state.selectedValue === null) {
    setState({ showValidation: true });
    return;
  }

  const session      = state.session;
  const qId          = session.order[session.currentIdx];
  const newAnswers   = Object.assign({}, session.answers, { [qId]: state.selectedValue });
  const nextIdx      = session.currentIdx + 1;
  const complete     = nextIdx >= session.order.length;

  const newSession = Object.assign({}, session, {
    answers:     newAnswers,
    currentIdx:  nextIdx,
    complete:    complete,
    completedAt: complete ? new Date().toISOString() : null,
  });

  saveSession(newSession);

  if (complete) {
    setState({ screen: 'complete', session: newSession, selectedValue: null, submitStatus: 'saving', submitErrorMsg: null });
    submitCompletedSession(newSession);
  } else {
    setState({ session: newSession, selectedValue: null, showValidation: false });
  }
}

/** Fires the background submission for a just-completed session, updating submitStatus as it resolves. */
async function submitCompletedSession(session) {
  try {
    await submitResults(session);
    setState({ submitStatus: 'saved', submitErrorMsg: null });
  } catch (err) {
    setState({ submitStatus: 'error', submitErrorMsg: err.message });
  }
}

function handleRetrySubmit() {
  setState({ submitStatus: 'saving', submitErrorMsg: null });
  submitCompletedSession(state.session);
}

function handleSaveAndExit() {
  saveSession(state.session);
  showToast('Progress saved — pick up where you left off anytime.');
  // Return to login after toast so user knows they can come back
  setTimeout(function () {
    setState({ screen: 'login', session: null, selectedValue: null, showValidation: false });
  }, 1200);
}

function handleNewSession() {
  setState({ screen: 'login', session: null, selectedValue: null, showValidation: false });
}

/* ─────────────────────────────────────────
   RENDER HELPERS
   ───────────────────────────────────────── */

function renderLogin() {
  const passcodeFromUrl = !!getKeyFromUrl() && !state.loadError;
  const errorHtml = state.loadError
    ? '<div class="validation-msg">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/>' +
        '</svg>' +
        esc(state.loadError) +
      '</div>'
    : '';

  return (
    '<div class="screen">' +
      '<div class="card login-card">' +
        '<div class="app-brand">' +
          '<div class="brand-mark">' + KENDRA_LOGO_SVG + '</div>' +
          '<span class="brand-name">Kendra Skilling</span>' +
        '</div>' +
        '<h1 class="display-heading login-heading">Skills Snapshot</h1>' +
        '<p class="login-desc">' +
          'A quick self-check across your technical skills. ' +
          'Be honest with your answers, there\'s no right or wrong here. ' +
          'Your progress saves automatically, so feel free to come back anytime within this browser.' +
        '</p>' +
        '<div class="divider"></div>' +
        '<label class="field-label" for="name-input">Your name</label>' +
        '<input type="text" id="name-input" placeholder="e.g. Alex Johnson" autocomplete="name" value="' + esc(state.pendingName) + '" />' +
        '<label class="field-label" for="email-input">Your email</label>' +
        '<input type="email" id="email-input" placeholder="e.g. alex@company.com" autocomplete="email" value="' + esc(state.pendingEmail) + '" />' +
        (passcodeFromUrl
          ? '<input type="hidden" id="passcode-input" value="' + esc(state.pendingPasscode) + '" />'
          : (
              '<label class="field-label" for="passcode-input">Assessment passcode</label>' +
              '<input type="password" id="passcode-input" placeholder="Provided by your administrator" autocomplete="off" value="' + esc(state.pendingPasscode) + '" />'
            )
        ) +
        errorHtml +
        '<button class="btn btn-primary btn-full" id="begin-btn" disabled>' +
          'Begin assessment' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

function renderLoading() {
  return (
    '<div class="screen">' +
      '<div class="card login-card">' +
        '<div class="app-brand">' +
          '<div class="brand-mark">' + KENDRA_LOGO_SVG + '</div>' +
          '<span class="brand-name">Kendra Skilling</span>' +
        '</div>' +
        '<p class="login-desc">Loading your assessment…</p>' +
      '</div>' +
    '</div>'
  );
}

function renderResume() {
  const s   = state.session;
  const pct = Math.round((s.currentIdx / s.order.length) * 100);
  const rem = s.order.length - s.currentIdx;

  return (
    '<div class="screen">' +
      '<div class="card resume-card">' +
        '<h2 class="display-heading resume-heading">Welcome back, ' + esc(s.name) + '</h2>' +
        '<p class="resume-sub">You have a saved session. Would you like to continue where you left off?</p>' +
        '<div class="resume-stats">' +
          '<div class="resume-stat"><span class="resume-stat-val">' + s.currentIdx + '</span><span class="resume-stat-lbl">Answered</span></div>' +
          '<div class="resume-stat"><span class="resume-stat-val">' + rem + '</span><span class="resume-stat-lbl">Remaining</span></div>' +
          '<div class="resume-stat"><span class="resume-stat-val">' + pct + '%</span><span class="resume-stat-lbl">Complete</span></div>' +
        '</div>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary" id="resume-btn">Continue assessment</button>' +
          '<button class="btn btn-secondary" id="restart-btn">Start over</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function renderQuestion() {
  const s         = state.session;
  const idx       = s.currentIdx;
  const total     = s.order.length;
  const qId       = s.order[idx];
  const q         = QUESTIONS.find(function (x) { return x.id === qId; });
  const pct       = Math.round((idx / total) * 100);
  const isLast    = idx === total - 1;

  const likertHtml = LIKERT_OPTIONS.map(function (opt) {
    const sel = state.selectedValue === opt.value ? ' selected' : '';
    return (
      '<div class="likert-option' + sel + '" data-value="' + opt.value + '" role="radio" ' +
           'aria-checked="' + (state.selectedValue === opt.value ? 'true' : 'false') + '" tabindex="0">' +
        '<div class="radio-ring"><div class="radio-dot"></div></div>' +
        '<span class="likert-label">' + esc(opt.label) + '</span>' +
      '</div>'
    );
  }).join('');

  const validationHtml = state.showValidation
    ? '<div class="validation-msg">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/>' +
        '</svg>' +
        'Please select a response before continuing.' +
      '</div>'
    : '';

  return (
    '<div class="screen">' +
      '<div class="card">' +

        // Header
        '<div class="q-header">' +
          '<div class="q-brand">' +
            '<span class="q-brand-mark">' + KENDRA_LOGO_SVG + '</span>' +
            '<span class="q-brand-name">Kendra Skilling</span>' +
          '</div>' +
          '<span class="q-user-name">' + esc(s.name) + '</span>' +
        '</div>' +

        // Progress bar
        '<div class="progress-section">' +
          '<div class="progress-top">' +
            '<span class="progress-label">Question ' + (idx + 1) + ' of ' + total + '</span>' +
            '<span class="progress-pct">' + pct + '%</span>' +
          '</div>' +
          '<div class="progress-track">' +
            '<div class="progress-fill" style="width:' + pct + '%"></div>' +
          '</div>' +
        '</div>' +

        // Body
        '<div class="q-body">' +
          '<div class="q-statement">' + esc(q.text) + '</div>' +
          '<div class="likert-group" role="radiogroup" aria-label="Rate your agreement">' +
            likertHtml +
          '</div>' +
          validationHtml +
        '</div>' +

        // Footer
        '<div class="q-footer">' +
          '<button class="btn btn-ghost" id="save-exit-btn">Save &amp; exit</button>' +
          '<button class="btn btn-primary" id="next-btn">' +
            (isLast ? 'Complete assessment' : 'Next') +
          '</button>' +
        '</div>' +

      '</div>' +
    '</div>'
  );
}

function renderSavedIndicator() {
  if (state.submitStatus === 'error') {
    return (
      '<div class="saved-indicator saved-indicator-error">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/>' +
        '</svg>' +
        'Couldn\'t save your answers' + (state.submitErrorMsg ? ' (' + esc(state.submitErrorMsg) + ')' : '') + '.' +
        '<button class="saved-retry-btn" id="retry-submit-btn">Retry</button>' +
      '</div>'
    );
  }

  if (state.submitStatus === 'saved') {
    return (
      '<div class="saved-indicator">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<polyline points="20 6 9 17 4 12"/>' +
        '</svg>' +
        'Your answers have been saved.' +
      '</div>'
    );
  }

  // 'saving' (or unset, e.g. mid-transition)
  return (
    '<div class="saved-indicator saved-indicator-pending">' +
      '<span class="saved-spinner"></span>' +
      'Saving your answers…' +
    '</div>'
  );
}

function renderComplete() {
  const s      = state.session;
  const vals   = Object.values(s.answers);
  const skills = new Set(
    Object.keys(s.answers).map(function (id) {
      const q = QUESTIONS.find(function (x) { return x.id === Number(id); });
      return q ? q.skill : '';
    })
  );

  return (
    '<div class="screen">' +
      '<div class="card complete-card">' +
        '<div class="complete-icon-wrap">' +
          '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#6422C9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="20 6 9 17 4 12"/>' +
          '</svg>' +
        '</div>' +
        '<h2 class="display-heading complete-heading">Well done, ' + esc(s.name) + '</h2>' +
        '<p class="complete-sub">' +
          'You\'ve completed the Skills Snapshot. ' +
          'Thanks for taking the time to reflect honestly on each statement.' +
        '</p>' +
        renderSavedIndicator() +
        '<div class="complete-stats">' +
          '<div class="stat-tile"><span class="stat-tile-val">' + vals.length + '</span><span class="stat-tile-lbl">Answered</span></div>' +
          '<div class="stat-tile"><span class="stat-tile-val">' + skills.size + '</span><span class="stat-tile-lbl">Areas covered</span></div>' +
        '</div>' +
        '<button class="btn btn-secondary btn-full" id="new-session-btn">Start a new session</button>' +
      '</div>' +
    '</div>'
  );
}

/* ─────────────────────────────────────────
   RENDER + EVENT BINDING
   ───────────────────────────────────────── */

function render() {
  const container = document.getElementById('screen-container');
  let html = '';

  switch (state.screen) {
    case 'login':    html = renderLogin();    break;
    case 'loading':  html = renderLoading();  break;
    case 'resume':   html = renderResume();   break;
    case 'question': html = renderQuestion(); break;
    case 'complete': html = renderComplete(); break;
    default:         html = renderLogin();
  }

  container.innerHTML = html;
  bindEvents();
}

function bindEvents() {
  switch (state.screen) {

    case 'login': {
      const input      = document.getElementById('name-input');
      const emailInput = document.getElementById('email-input');
      const passInput  = document.getElementById('passcode-input');
      const btn        = document.getElementById('begin-btn');

      function refreshBtn() {
        const hasName  = input.value.trim().length > 0;
        const hasEmail = /\S+@\S+\.\S+/.test(emailInput.value.trim());
        const hasPass  = passInput.value.trim().length > 0;
        btn.disabled = !(hasName && hasEmail && hasPass);
      }

      function trySubmit(e) {
        if (e.key === 'Enter' && !btn.disabled) {
          handleLoginSubmit(input.value, emailInput.value, passInput.value);
        }
      }

      input.addEventListener('input', refreshBtn);
      input.addEventListener('keydown', trySubmit);
      emailInput.addEventListener('input', refreshBtn);
      emailInput.addEventListener('keydown', trySubmit);
      if (passInput.type !== 'hidden') {
        passInput.addEventListener('input', refreshBtn);
        passInput.addEventListener('keydown', trySubmit);
      }

      btn.addEventListener('click', function () {
        handleLoginSubmit(input.value, emailInput.value, passInput.value);
      });

      refreshBtn();
      input.focus();
      break;
    }

    case 'loading': {
      // No interactive elements.
      break;
    }

    case 'resume': {
      document.getElementById('resume-btn').addEventListener('click', handleResume);
      document.getElementById('restart-btn').addEventListener('click', handleRestart);
      break;
    }

    case 'question': {
      // Likert options: click and keyboard
      document.querySelectorAll('.likert-option').forEach(function (el) {
        el.addEventListener('click', function () {
          handleSelectOption(parseInt(el.dataset.value, 10));
        });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelectOption(parseInt(el.dataset.value, 10));
          }
        });
      });

      document.getElementById('next-btn').addEventListener('click', handleNext);
      document.getElementById('save-exit-btn').addEventListener('click', handleSaveAndExit);
      break;
    }

    case 'complete': {
      document.getElementById('new-session-btn').addEventListener('click', handleNewSession);
      const retryBtn = document.getElementById('retry-submit-btn');
      if (retryBtn) retryBtn.addEventListener('click', handleRetrySubmit);
      break;
    }
  }
}

/* ─────────────────────────────────────────
   BOOT
   ───────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function () {
  render();
});
