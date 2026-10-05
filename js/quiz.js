// Pure quiz-session core, extracted from app.js (which is DOM-entangled at
// import time and cannot be imported under Node) so the quiz state machine can
// be unit-tested. No DOM, no storage: the caller (app.js) persists best-score
// and XP from the returned { done, pct }.
//
// The RNG is injectable for deterministic tests; production uses Math.random.

export const QUIZ_LEN = 10;

// Sample pool for brand-new users who haven't starred any letters yet.
export const FALLBACK_POOL = ['A', 'B', 'C', 'L', 'V', 'Y'];

// Build the question list for one run: the letters the user has starred,
// shuffled; falls back to a fixed sampler pool when fewer than 4 are unlocked.
// The list is capped at QUIZ_LEN entries.
export function pickQuizLetters(starred, rng = Math.random) {
  return (starred.length >= 4 ? starred : FALLBACK_POOL)
    .slice()
    .sort(() => rng() - 0.5)
    .slice(0, QUIZ_LEN);
}

export function newQuiz(letters) {
  // A quiz is exactly as long as its question list (BUGFIX 2026-10-05): the
  // list can be shorter than QUIZ_LEN (fallback pool has 6 entries; 4-9
  // starred letters give that many questions). The old logic kept going until
  // idx >= QUIZ_LEN, showing `undefined` as the target letter from question
  // letters.length+1 on.
  return { letters, len: letters.length, idx: 0, correct: 0, done: false, phase: 'question', lastAnswer: null };
}

// Apply one answer to the quiz state (mutates q, as app.js always did) and
// report whether the run just finished, plus the final percentage.
export function answerQuiz(q, ok, seen) {
  q.lastAnswer = ok;
  q.seenLetter = seen;
  if (ok) q.correct++;
  q.idx++;
  const done = q.idx >= q.len;
  const pct = Math.round((q.correct / q.len) * 100);
  q.done = done;
  return { done, pct };
}
