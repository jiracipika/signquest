// Quiz state-machine tests against the pure core in js/quiz.js (extracted
// from app.js). Follows the repo's node:test + assert/strict conventions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIZ_LEN, FALLBACK_POOL, pickQuizLetters, newQuiz, answerQuiz } from '../js/quiz.js';

// deterministic rng for shuffle assertions
function seededRng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('pickQuizLetters samples the starred pool once >= 4 letters are unlocked', () => {
  const starred = ['A', 'B', 'C', 'D', 'E'];
  for (const seed of [1, 2, 3]) {
    const letters = pickQuizLetters(starred, seededRng(seed));
    assert.equal(letters.length, starred.length); // pool < QUIZ_LEN -> whole pool
    assert.deepEqual([...letters].sort(), [...starred].sort()); // permutation, no dupes
    for (const L of letters) assert.ok(starred.includes(L), `${L} not from starred pool`);
  }
});

test('pickQuizLetters caps the list at QUIZ_LEN questions', () => {
  const starred = 'ABCDEFGHIJKLMNOPQRSTUVWY'.split(''); // 23 unlocked
  const letters = pickQuizLetters(starred, seededRng(7));
  assert.equal(letters.length, QUIZ_LEN);
  for (const L of letters) assert.ok(starred.includes(L));
});

test('pickQuizLetters falls back to the sampler pool for brand-new users', () => {
  const letters = pickQuizLetters(['A', 'B'], seededRng(11));
  assert.equal(letters.length, FALLBACK_POOL.length);
  for (const L of letters) assert.ok(FALLBACK_POOL.includes(L), `${L} not in fallback pool`);
});

// THE PIN (2026-10-05): a quiz is exactly as long as its question list. The
// old app logic kept running until idx >= QUIZ_LEN, so a 6-question list (new
// user fallback pool, or 4-9 starred letters) hit `letters[idx] === undefined`
// from question 7 on — the screen showed "undefined" as the target letter and
// "Check with camera" started practice on [undefined].
test('a short quiz ends after its last question — no undefined questions', () => {
  const letters = pickQuizLetters(['A', 'B', 'C', 'D', 'E', 'F'], seededRng(5)); // 6 questions
  const q = newQuiz(letters);
  assert.equal(q.letters.length, 6);
  assert.ok(q.letters.length < QUIZ_LEN, 'fixture must be shorter than QUIZ_LEN');

  // every question the quiz will show references a real letter
  for (let i = 0; i < q.letters.length; i++) {
    assert.ok(q.letters[i], `question ${i + 1} has no letter`);
  }

  // answering every question correctly finishes the run at 100%
  let res = null;
  for (let i = 0; i < q.letters.length; i++) {
    assert.equal(q.done, false, `quiz ended early at question ${i + 1}`);
    res = answerQuiz(q, true, q.letters[i]);
  }
  assert.equal(q.done, true);
  assert.equal(res.done, true);
  assert.equal(res.pct, 100); // 6/6, not 6/10
});

test('a full-length quiz still runs QUIZ_LEN questions and scores out of 10', () => {
  const starred = 'ABCDEFGHIJKLMNOPQRSTUVWY'.split('');
  const q = newQuiz(pickQuizLetters(starred, seededRng(9)));
  assert.equal(q.letters.length, QUIZ_LEN);
  let res = null;
  for (let i = 0; i < QUIZ_LEN - 1; i++) res = answerQuiz(q, true, q.letters[i]);
  assert.equal(q.done, false); // 9 of 10 answered
  res = answerQuiz(q, false, 'M');
  assert.equal(q.done, true);
  assert.equal(q.correct, 9);
  assert.equal(res.pct, 90);
});

test('answerQuiz records wrong answers and the letter actually seen', () => {
  const q = newQuiz(['A', 'B', 'C', 'L']);
  const res = answerQuiz(q, false, 'M');
  assert.equal(q.lastAnswer, false);
  assert.equal(q.seenLetter, 'M');
  assert.equal(q.correct, 0);
  assert.equal(q.idx, 1);
  assert.equal(res.done, false);
});
