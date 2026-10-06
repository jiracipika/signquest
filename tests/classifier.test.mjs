import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canonicalLandmarks, STATIC_LETTERS } from '../js/geometry.js';
import { classify, extractFeatures, perturb, letterToLandmarks, margin, SmoothedClassifier } from '../js/classifier.js';

// Real-hand fixtures: 12 samples per letter (26 letters) in the canonical
// frame, extracted with MediaPipe from the Marxulia/asl_sign_languages_alphabets_v03
// dataset — the same extraction the prototypes were built from. J/Z are static
// photos of movement letters (shape ~ I / D); their static rows exercise the
// confusion but their RECOGNITION is motion.js's job, so the accuracy floors
// below only score the 24 static letters.
const FIXTURES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'asl-letter-fixtures-v1.json'), 'utf8')
);
const toPts = (lm) => lm.map((p) => ({ x: p[0], y: p[1], z: p[2] }));

test('every static letter has a canonical skeleton with 21 finite points', () => {
  for (const L of STATIC_LETTERS) {
    const lm = canonicalLandmarks(L);
    assert.ok(lm, `${L} missing pose spec`);
    assert.equal(lm.length, 21, `${L} wrong landmark count`);
    for (const p of lm) assert.ok(isFinite(p.x + p.y + p.z), `${L} non-finite point`);
  }
});

test('extractFeatures rejects garbage input', () => {
  assert.equal(extractFeatures(new Array(21).fill(null)), null);
  const flat = new Array(21).fill({ x: 0.5, y: 0.5, z: 0 }); // collinear → no palm normal
  assert.equal(extractFeatures(flat), null);
});

// THE PIN (2026-10-05, dataset grounding): prototypes are now k-means
// centroids over 3,120 real landmark samples. The old hand-authored prototypes
// scored 40.6% on that data; the dataset prototypes score ~85% held-out
// (93.4% train-through). This floor pins the regression line on the committed
// real-hand fixtures (a training subset, so the bar sits above held-out).
test('classifier recognizes real-hand fixtures (dataset-derived prototypes)', () => {
  let ok = 0;
  let total = 0;
  const conf = {};
  for (const [L, arrs] of Object.entries(FIXTURES)) {
    if (L === 'J' || L === 'Z') continue;
    for (const lm of arrs) {
      total++;
      const r = classify(toPts(lm));
      if (r && r.letter === L) ok++;
      else (conf[L] ||= []).push(r ? r.letter : 'null');
    }
  }
  const pct = ok / total;
  assert.ok(
    pct >= 0.88,
    `real-fixture accuracy ${(pct * 100).toFixed(1)}% below the 88% floor (${ok}/${total}): ${JSON.stringify(conf)}`
  );
});

test('classifier robust to in-plane rotation + scale + jitter on real hands', () => {
  const fails = [];
  for (const [L, arrs] of Object.entries(FIXTURES)) {
    if (L === 'J' || L === 'Z') continue;
    for (const lm of arrs) {
      for (const [seed, angle, scale, jitter] of [
        [1, 0.3, 1.4, 0.01], [2, -0.5, 0.7, 0.01], [3, 1.2, 1.0, 0.02], [4, -2.0, 0.9, 0.015],
      ]) {
        const r = classify(perturb(toPts(lm), { angle, scale, jitter, seed }));
        if (!r || r.letter !== L) fails.push(`${L} (seed ${seed}) -> ${r ? r.letter : 'null'}`);
      }
    }
  }
  // measured 99/1152 misclassifications under this stress; the floor allows
  // the same rate plus headroom (≈10%)
  assert.ok(fails.length <= 120, `too many perturbed misclassifications (${fails.length}/1152): ${fails.slice(0, 10).join(', ')}...`);
});

test('mirror invariance: a mirrored left-hand image classifies as the same letter', () => {
  // Property (not accuracy): extractFeatures canonicalizes chirality, so an
  // image-level x-mirror of any real sample must classify identically. MediaPipe's
  // relative-depth channel is not a consistent 3D mirror, so agreement is
  // measured, not perfect: 91.0% on these fixtures (z-sensitive curved letters
  // C/O carry most of the disagreement).
  let agree = 0;
  let total = 0;
  const fails = [];
  for (const [L, arrs] of Object.entries(FIXTURES)) {
    if (L === 'J' || L === 'Z') continue;
    for (const lm of arrs) {
      total++;
      const a = classify(toPts(lm));
      const b = classify(toPts(lm).map((p) => ({ x: -p.x, y: p.y, z: p.z })));
      if (a && b && a.letter === b.letter) agree++;
      else fails.push(`${L}:${a ? a.letter : 'null'}/${b ? b.letter : 'null'}`);
    }
  }
  assert.ok(
    agree / total >= 0.87,
    `mirror agreement ${(100 * agree / total).toFixed(1)}% below the 87% floor: ${fails.slice(0, 10).join(', ')}`
  );
});

// ---- smoothing + margin contracts (the app's stability layer) -------------

test('SmoothedClassifier ignores null frames without polluting the window', () => {
  const s = new SmoothedClassifier(3);
  assert.equal(s.push(null), null);
  const r = s.push({ letter: 'A', scores: { A: 1, B: 2 } });
  assert.equal(r.letter, 'A');
  assert.equal(r.agreement, 1); // buffer holds only the real frame
});

test('majority vote flips once the new letter wins the window', () => {
  const s = new SmoothedClassifier(3);
  s.push({ letter: 'A', scores: {} });
  s.push({ letter: 'A', scores: {} });
  // 2v1 -> A still leads.
  assert.equal(s.push({ letter: 'B', scores: {} }).letter, 'A');
  // Window [A,B,B] -> B leads 2v1. Regression: a `best.c` typo made the
  // vote return the window's OLDEST letter forever (never flipped).
  assert.equal(s.push({ letter: 'B', scores: {} }).letter, 'B');
});

test('window is bounded at n frames (old letters evicted)', () => {
  const s = new SmoothedClassifier(3);
  for (let i = 0; i < 5; i++) s.push({ letter: 'A', scores: {} });
  const r = s.push({ letter: 'B', scores: {} });
  // Buffer is [A,A,B] (n=3 evicts oldest) -> majority A at 2/3 agreement.
  assert.equal(r.letter, 'A');
  assert.equal(r.agreement, 2 / 3);
  s.push({ letter: 'B', scores: {} });
  s.push({ letter: 'B', scores: {} });
  assert.equal(s.push({ letter: 'B', scores: {} }).letter, 'B');
});

test('reset clears the window', () => {
  const s = new SmoothedClassifier(3);
  s.push({ letter: 'A', scores: {} });
  s.reset();
  const r = s.push({ letter: 'B', scores: {} });
  assert.equal(r.letter, 'B');
  assert.equal(r.agreement, 1);
});

// ---- flicker grace (2026-10-05): no-hand frames no longer wipe the window --

test('a single dropped frame mid-streak keeps the vote', () => {
  const s = new SmoothedClassifier(3, 1); // grace: 1 tolerated no-hand frame
  s.push({ letter: 'A', scores: {} });
  s.push({ letter: 'A', scores: {} });
  const held = s.absent(); // dropout: vote is held, window untouched
  assert.deepEqual({ letter: held.letter, agreement: held.agreement }, { letter: 'A', agreement: 1 });
  const r = s.push({ letter: 'A', scores: {} });
  assert.equal(r.letter, 'A');
  assert.equal(r.agreement, 1); // window never lost a letter: still [A,A,A]
  assert.equal(s.buf.length, 3);
});

test('sustained absence past the grace window resets, so a new hand starts clean', () => {
  const s = new SmoothedClassifier(3, 1);
  for (let i = 0; i < 3; i++) s.push({ letter: 'A', scores: {} });
  assert.equal(s.absent().letter, 'A'); // 1st no-hand frame: still within grace
  assert.equal(s.absent(), null);       // 2nd consecutive: grace exceeded -> reset
  const r = s.push({ letter: 'B', scores: {} });
  assert.equal(r.letter, 'B');
  assert.equal(r.agreement, 1); // not diluted by the stale A window
});

test('a detected hand restarts the absence grace counter', () => {
  const s = new SmoothedClassifier(3, 1);
  s.push({ letter: 'A', scores: {} });
  s.absent();                     // one dropout, held
  s.push({ letter: 'A', scores: {} }); // hand back -> grace counter restarts
  const held = s.absent();        // another single dropout: still held
  assert.equal(held.letter, 'A');
  assert.equal(s.buf.length, 2);
});

test('absent on an empty window is a no-op returning null', () => {
  const s = new SmoothedClassifier(3);
  assert.equal(s.absent(), null);
  assert.equal(s.buf.length, 0);
});

test('margin: confident results gap more than contested ones', () => {
  const confident = margin({ letter: 'A', scores: { A: 1.0, B: 2.4 } });
  const contested = margin({ letter: 'B', scores: { A: 1.0, B: 2.0 } });
  assert.equal(confident, 1.4);
  assert.equal(contested, 1.0);
  assert.ok(confident > contested);
});

test('margin of a null result is 0', () => {
  assert.equal(margin(null), 0);
});
