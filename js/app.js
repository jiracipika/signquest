// SignQuest app logic: lessons (Duolingo-style progression), reference, quiz,
// and the camera practice loop. State persists in localStorage.

import { STATIC_LETTERS, MOTION_LETTERS } from './geometry.js';
import { renderLetterTarget } from './render.js';
import { HandTracker } from './camera.js';
import { pickQuizLetters, newQuiz, answerQuiz } from './quiz.js';
import { MotionTracker, MIN_PATH } from './motion.js';

const STORE_KEY = 'signquest-progress-v1';

const ALL_LETTERS = [...STATIC_LETTERS, ...MOTION_LETTERS];

// Lesson units, Duolingo-style: bite-sized groups in teaching order.
const UNITS = [
  { letters: ['A', 'B', 'C'], note: 'The basics' },
  { letters: ['D', 'E', 'F'], note: 'Pinches & curves' },
  { letters: ['G', 'H', 'I'], note: 'Sideways & pinky' },
  { letters: ['K', 'L', 'U'], note: 'Thumbs up combos' },
  { letters: ['V', 'W', 'X'], note: 'Pointy group' },
  { letters: ['M', 'N', 'T'], note: 'The tricky fist trio' },
  { letters: ['O', 'P', 'Q'], note: 'Rings & pointers' },
  { letters: ['R', 'S', 'Y'], note: 'Finale' },
  { letters: ['J', 'Z'], note: 'The movement letters — trace them' },
];

const LETTER_HELP = {
  A: 'Fist, thumb flat against the side pointing up.',
  B: 'Fingers together and straight up, thumb folded across your palm.',
  C: 'Curve all fingers and thumb like holding a can — open gap.',
  D: 'Index finger straight up, other fingers closed, thumb touches middle fingertip.',
  E: 'Fingers curled down onto the thumb, tips resting near it.',
  F: 'Thumb and index fingertip pinch (like "OK"), other three fingers up.',
  G: 'Index finger points sideways, thumb parallel just below it — like a small clamp.',
  H: 'Index + middle together pointing sideways, thumb holds ring/pinky down.',
  I: 'Pinky up, everything else closed. Thumb across the palm.',
  J: 'Pinky up from a fist, then TRACE a J in the air: down, hook to the left.',
  K: 'Index + middle up in a V, thumb tucked between them.',
  L: 'Index up, thumb straight out — a capital L.',
  M: 'Fist with thumb tucked UNDER index, middle AND ring (three fingers).',
  N: 'Fist with thumb tucked under index and middle (two fingers).',
  O: 'All fingertips meet the thumb in a round "O" shape.',
  P: 'Like K, but pointing DOWN.',
  Q: 'Like G, but pointing DOWN.',
  R: 'Index + middle crossed, pointing up.',
  S: 'Fist with thumb crossing IN FRONT of the fingers.',
  T: 'Fist with thumb tucked between index and middle (one finger).',
  U: 'Index + middle up, held together side by side.',
  V: 'Index + middle up, spread apart.',
  W: 'Index, middle and ring up — three fingers spread.',
  X: 'Index finger bent into a hook, everything else closed.',
  Y: 'Thumb and pinky out, middle fingers closed — "hang loose".',
  Z: 'Index up from a fist, then TRACE a Z in the air: across, diagonal, across.',
};

// ---- persistent state ----
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.letters) return s;
  } catch {}
  return { letters: {}, xp: 0, streak: 1, lastDay: today(), quizBest: 0 };
}
function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function rollStreak() {
  const t = today();
  if (state.lastDay === t) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  state.streak = state.lastDay === yesterday ? state.streak + 1 : 1;
  state.lastDay = t;
  saveState();
}

let state = loadState();
rollStreak();

function letterStars(L) {
  return state.letters[L] || 0;
}

// ---- top bar ----
function updateTopbar() {
  document.getElementById('stat-streak').textContent = `🔥 ${state.streak}`;
  document.getElementById('stat-xp').textContent = `⭐ ${state.xp} XP`;
}

// ---- router ----
const view = document.getElementById('view');
const navButtons = [...document.querySelectorAll('.nav-btn')];
navButtons.forEach((b) =>
  b.addEventListener('click', () => showView(b.dataset.nav))
);
function showView(name) {
  navButtons.forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
  if (name === 'home') renderHome();
  else if (name === 'reference') renderReference();
  else if (name === 'quiz') renderQuiz();
}

// ---- home ----
function renderHome() {
  document.title = 'SignQuest — Lessons';
  const unlockedCount = countUnlocked();
  view.innerHTML = `
    <div class="hero">
      <h1>Learn the ASL alphabet with your camera</h1>
      <p>Each letter is a lesson: watch the target shape, hold it with your hand in view —
      three stars means you nailed it. ${unlockedCount}/26 letters unlocked (J and Z are traced in the air).</p>
    </div>
    ${UNITS.map((u, ui) => {
      const prevDone = ui === 0 || UNITS[ui - 1].letters.some((L) => letterStars(L) > 0);
      const unitUnlocked = prevDone;
      return `
      <section class="unit">
        <div class="unit-head">
          <h2>Unit ${ui + 1} · ${u.note}</h2>
          <span class="unit-note">${u.letters.map((L) => letterStars(L) ? '★'.repeat(letterStars(L)) : '☆ ' + L).join('   ')}</span>
        </div>
        <div class="letter-grid">
          ${u.letters.map((L) => {
            const stars = letterStars(L);
            const isNew = stars === 0 && unitUnlocked;
            return `
            <button class="letter-node ${stars === 0 && !unitUnlocked ? 'locked' : ''} ${isNew ? 'new' : ''}" data-letter="${L}">
              ${stars === 0 && !unitUnlocked ? '🔒' : ''}
              <div class="glyph">${L}</div>
              <div class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
              ${isNew ? '<span class="badge">START</span>' : ''}
            </button>`;
          }).join('')}
        </div>
      </section>`;
    }).join('')}
  `;
  view.querySelectorAll('.letter-node:not(.locked)').forEach((n) =>
    n.addEventListener('click', () => startPractice([n.dataset.letter]))
  );
}

function countUnlocked() {
  return ALL_LETTERS.filter((L) => letterStars(L) > 0).length;
}

// ---- reference ----
function renderReference() {
  document.title = 'SignQuest — Reference';
  view.innerHTML = `
    <div class="hero"><h1>ASL Alphabet Reference</h1>
    <p>Idealized skeleton for every letter — generated from the same model the
    camera checker uses. Tap a card to practice it.</p></div>
    <div class="ref-grid">
      ${STATIC_LETTERS.map((L) => `
        <div class="ref-card" data-letter="${L}" role="button" tabindex="0">
          <canvas width="140" height="150"></canvas>
          <div class="ref-letter">${L}</div>
          <div class="ref-desc">${LETTER_HELP[L]}</div>
        </div>`).join('')}
    </div>`;
  view.querySelectorAll('.ref-card').forEach((card) => {
    renderLetterTarget(card.querySelector('canvas'), card.dataset.letter);
    const go = () => startPractice([card.dataset.letter]);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  });
}

// ---- quiz ----
// Flow logic lives in js/quiz.js (pure, unit-tested); this layer is DOM only.
let quiz = null;
function renderQuiz() {
  document.title = 'SignQuest — Quiz';
  if (!quiz || quiz.done) {
    quiz = makeQuiz();
  }
  drawQuiz();
}
function makeQuiz() {
  return newQuiz(pickQuizLetters(ALL_LETTERS.filter((L) => letterStars(L) > 0)));
}
function drawQuiz() {
  const q = quiz;
  if (q.done) {
    const pct = Math.round((q.correct / q.len) * 100);
    view.innerHTML = `
      <div class="quiz-card">
        <div class="quiz-big">${pct >= 80 ? '🏆' : pct >= 50 ? '👍' : '📚'}</div>
        <h2>${q.correct} / ${q.len} correct (${pct}%)</h2>
        <p style="color:var(--text-dim);margin-top:6px">Best: ${state.quizBest}%</p>
        <button class="quiz-btn" id="quiz-again">Play again</button>
      </div>`;
    document.getElementById('quiz-again').onclick = () => { quiz = makeQuiz(); drawQuiz(); };
    return;
  }
  const L = q.letters[q.idx];
  view.innerHTML = `
    <div class="quiz-card">
      <div style="color:var(--text-dim)">Question ${q.idx + 1} of ${q.len}</div>
      <div class="quiz-big">${L}</div>
      <p style="color:var(--text-dim)">Show this letter to the camera</p>
      <div class="quiz-result" id="quiz-result">${q.lastAnswer === null ? '' :
        q.lastAnswer ? '✅ Correct!' : `❌ That looked like ${q.seenLetter ?? 'nothing recognizable'}`}</div>
      <button class="quiz-btn" id="quiz-cam">📷 Check with camera</button>
      <button class="quiz-btn secondary" id="quiz-skip">Skip</button>
      <div class="quiz-timer"><div id="quiz-timer-fill" style="width:${(1 - q.idx / q.len) * 100}%"></div></div>
    </div>`;
  document.getElementById('quiz-skip').onclick = () => { advanceQuiz(false, null); };
  document.getElementById('quiz-cam').onclick = () =>
    startPractice([L], { onHold: (ok, seen) => advanceQuiz(ok, ok ? L : (seen || lastSeenLetter)) });
}
function advanceQuiz(ok, seen) {
  const res = answerQuiz(quiz, ok, seen);
  if (res.done && res.pct > state.quizBest) { state.quizBest = res.pct; state.xp += 25; saveState(); }
  drawQuiz();
}

// ---- camera practice ----
const practiceEl = document.getElementById('practice');
let tracker = null;
let practice = null;

function startPractice(letters, opts = {}) {
  lastFrameTs = 0; // fresh session: first frame uses the default dt instead of
                   // a stale gap carried over from the previous session
  practice = {
    letters,
    idx: 0,
    stars: 0,
    holdMs: 0,
    HOLD_NEEDED: 1200,
    onHold: opts.onHold || null,
    singleMode: !!opts.onHold,
    motion: new MotionTracker(), // J/Z trajectory tracking (idle for static letters)
    otherMs: 0,                  // quiz: how long a WRONG letter has been held
    otherLetter: null,
  };
  practiceEl.classList.remove('hidden');
  updatePracticeUI();
  runTracker();
}

function updatePracticeUI() {
  const L = practice.letters[practice.idx];
  document.getElementById('practice-title').textContent = practice.singleMode
    ? `Show: ${L}`
    : `Letter ${L}`;
  document.getElementById('practice-progress').textContent =
    practice.singleMode ? '' : `${practice.idx + 1} / ${practice.letters.length}`;
  renderLetterTarget(document.getElementById('target-canvas'), L);
  document.getElementById('target-help').textContent = LETTER_HELP[L];
  document.getElementById('hold-fill').style.width = '0%';
  document.getElementById('feedback-sees').textContent = 'Camera starting…';
}

async function runTracker() {
  const video = document.getElementById('cam');
  const overlay = document.getElementById('overlay');
  tracker = new HandTracker();
  tracker.onResult = onFrameResult;
  try {
    await tracker.start(video, overlay);
    document.getElementById('camera-msg').classList.add('hidden');
  } catch (e) {
    const msg = document.getElementById('camera-msg');
    msg.textContent = e.name === 'NotAllowedError'
      ? 'Camera permission was blocked. Allow camera access and try again.'
      : (e.message || 'Could not start the camera.');
    msg.classList.remove('hidden');
  }
}

let lastSeenLetter = null;
let lastFrameTs = 0;
const isMotionLetter = (L) => MOTION_LETTERS.includes(L);

function onFrameResult(info) {
  if (!practice) return;
  const now = performance.now();
  const dt = lastFrameTs ? Math.min(200, now - lastFrameTs) : 16;
  lastFrameTs = now;
  const L = practice.letters[practice.idx];
  const sees = document.getElementById('feedback-sees');
  const quality = document.getElementById('feedback-quality');
  const fill = document.getElementById('hold-fill');

  if (!info.hand) {
    sees.textContent = '👋 Show your hand to the camera';
    quality.textContent = '';
    // Flicker-policy alignment (2026-10-05): the smoother HOLDS its vote
    // through brief dropouts, so the hold bar decays instead of hard-resetting
    // — a 1-frame detection gap no longer wipes a second of progress.
    practice.holdMs = Math.max(0, practice.holdMs - dt);
    fill.style.width = (practice.holdMs / practice.HOLD_NEEDED) * 100 + '%';
    return;
  }

  // ---- movement letters (J/Z): recognized by tracing, not by shape ----------
  if (isMotionLetter(L)) {
    const m = practice.motion.feed(info.landmarks, now);
    const len = practice.motion.livePathLength;
    fill.style.width = Math.min(100, (len / MIN_PATH) * 100) + '%';
    quality.textContent = `traced ${Math.round(len * 10) / 10} of ${MIN_PATH} palm-widths`;
    if (!m) {
      sees.textContent = `Trace the ${L} — draw it in the air with your ${L === 'J' ? 'pinky' : 'index'}`;
      return;
    }
    lastSeenLetter = m.letter;
    practice.motion.reset();
    if (m.letter !== L) {
      sees.textContent = `Traced a ${m.letter} — that's not ${L}. Try again.`;
      return;
    }
    sees.textContent = `${L} traced! ✓`;
    if (practice.singleMode) {
      advanceQuiz(true, L);
      closePractice();
    } else {
      holdComplete();
    }
    return;
  }

  lastSeenLetter = info.letter;
  const match = info.letter === L;
  sees.textContent = `Seeing: ${info.letter} ${match ? '✓' : `(${Math.round(info.agreement * 100)}% sure)`}`;
  quality.textContent = `shape match ${Math.max(0, 100 - Math.round(info.distance * 100))}%`;

  if (match) {
    practice.holdMs += dt;
    const pct = Math.min(100, (practice.holdMs / practice.HOLD_NEEDED) * 100);
    fill.style.width = pct + '%';
    if (practice.holdMs >= practice.HOLD_NEEDED) {
      holdComplete();
    }
  } else {
    practice.holdMs = Math.max(0, practice.holdMs - dt * 2);
    fill.style.width = (practice.holdMs / practice.HOLD_NEEDED) * 100 + '%';
    if (practice.singleMode) {
      // Wrong-answer recording (2026-10-05): onHold(false) used to be
      // unreachable — holdComplete was its only caller and always passed true,
      // so every quiz miss rendered "That looked like null". A DIFFERENT
      // letter held confidently for the full window is a genuine wrong answer.
      if (practice.otherLetter === info.letter) practice.otherMs += dt;
      else { practice.otherLetter = info.letter; practice.otherMs = 0; }
      if (practice.otherMs >= practice.HOLD_NEEDED) {
        advanceQuiz(false, info.letter);
        closePractice();
      }
    }
  }
}

function holdComplete() {
  const L = practice.letters[practice.idx];
  practice.holdMs = 0;
  practice.motion.reset(); // next letter starts with a clean trajectory buffer
  state.letters[L] = Math.min(3, letterStars(L) + 1);
  state.xp += 10;
  saveState();
  updateTopbar();
  document.querySelector('.camera-wrap').classList.remove('flash-good');
  void document.querySelector('.camera-wrap').offsetWidth;
  document.querySelector('.camera-wrap').classList.add('flash-good');

  if (practice.onHold) {
    practice.onHold(true, L);
    closePractice();
    return;
  }
  practice.idx++;
  if (practice.idx >= practice.letters.length) {
    endPractice();
  } else {
    updatePracticeUI();
  }
}

function endPractice() {
  const earned = practice.letters.map((L) => `${L} ★${letterStars(L)}`).join('  ');
  document.getElementById('practice-title').textContent = 'Lesson complete! 🎉';
  document.getElementById('feedback-sees').textContent = earned + `   +${practice.letters.length * 10} XP`;
  document.getElementById('hold-fill').style.width = '100%';
  setTimeout(closePractice, 1800);
}

function closePractice() {
  practice = null;
  practiceEl.classList.add('hidden');
  if (tracker) {
    tracker.stop(document.getElementById('cam'));
    tracker = null;
  }
  if (!document.querySelector('.nav-btn.active').dataset.nav) showView('home');
  else showView(document.querySelector('.nav-btn.active').dataset.nav);
}

document.getElementById('practice-close').addEventListener('click', closePractice);

// ---- boot ----
updateTopbar();
renderHome();
