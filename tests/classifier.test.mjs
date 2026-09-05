import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalLandmarks, STATIC_LETTERS } from '../js/geometry.js';
import { classify, extractFeatures, perturb, letterToLandmarks } from '../js/classifier.js';

test('every static letter has a canonical skeleton with 21 finite points', () => {
  for (const L of STATIC_LETTERS) {
    const lm = canonicalLandmarks(L);
    assert.ok(lm, `${L} missing pose spec`);
    assert.equal(lm.length, 21, `${L} wrong landmark count`);
    for (const p of lm) assert.ok(isFinite(p.x + p.y + p.z), `${L} non-finite point`);
  }
});

test('classifier recognizes all 24 canonical letters (zero-noise fixtures)', () => {
  const fails = [];
  for (const L of STATIC_LETTERS) {
    const lm = canonicalLandmarks(L);
    const r = classify(lm);
    if (!r || r.letter !== L) fails.push(`${L}->${r ? r.letter : 'null'}`);
  }
  assert.deepStrictEqual(fails, [], `canonical misclassifications: ${fails.join(', ')}`);
});

test('classifier robust to in-plane rotation + scale + jitter', () => {
  const fails = [];
  for (const L of STATIC_LETTERS) {
    for (const [seed, angle, scale, jitter] of [
      [1, 0.3, 1.4, 0.01], [2, -0.5, 0.7, 0.01], [3, 1.2, 1.0, 0.02], [4, -2.0, 0.9, 0.015],
    ]) {
      const lm = perturb(canonicalLandmarks(L), { angle, scale, jitter, seed });
      const r = classify(lm);
      if (!r || r.letter !== L) fails.push(`${L} (seed ${seed}) -> ${r ? r.letter : 'null'}`);
    }
  }
  // allow a small number of hard-case misses under heavy jitter, but canonical
  // (jitter=0) cases must never fail
  assert.ok(fails.length <= 4, `too many perturbed misclassifications: ${fails.join(', ')}`);
});

test('extractFeatures rejects garbage input', () => {
  assert.equal(extractFeatures(new Array(21).fill(null)), null);
  const flat = new Array(21).fill({ x: 0.5, y: 0.5, z: 0 }); // collinear → no palm normal
  assert.equal(extractFeatures(flat), null);
});

test('mirror invariance: left hand (mirrored x) still classifies', () => {
  const fails = [];
  for (const L of STATIC_LETTERS) {
    const lm = canonicalLandmarks(L).map((p) => ({ x: -p.x, y: p.y, z: p.z }));
    const r = classify(lm);
    if (!r || r.letter !== L) fails.push(`${L}->${r ? r.letter : 'null'}`);
  }
  assert.ok(fails.length <= 2, `mirror fails: ${fails.join(', ')}`);
});
