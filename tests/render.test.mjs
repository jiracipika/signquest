// render.js decision tests: what gets drawn for a given state. Canvas is
// stubbed with a recording context (no DOM needed) — we assert the draw
// DECISIONS (draw/no-draw, fit bounds, y-flip), not pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLetterTarget } from '../js/render.js';
import { canonicalLandmarks, STATIC_LETTERS } from '../js/geometry.js';

function recordingCanvas(w = 140, h = 150) {
  const calls = [];
  const ctx = { lineWidth: 0, strokeStyle: '', fillStyle: '', lineCap: '' };
  for (const m of ['clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill']) {
    ctx[m] = (...args) => calls.push({ name: m, args });
  }
  ctx._calls = calls;
  ctx._count = (name) => calls.filter((c) => c.name === name).length;
  return { width: w, height: h, ctx, getContext: () => ctx };
}

// 21 bone segments (4+4 per finger chain pairs + palm base) — matches render.js
const BONES = 21;

test('unknown letter draws nothing (graceful no-op)', () => {
  const c = recordingCanvas();
  renderLetterTarget(c, 'Z'); // motion letter, not in the pose set
  assert.equal(c.ctx._count('moveTo'), 0);
  assert.equal(c.ctx._count('lineTo'), 0);
  assert.equal(c.ctx._count('arc'), 0);
});

test('every letter skeleton is drawn and fits inside its canvas', () => {
  for (const L of STATIC_LETTERS) {
    const c = recordingCanvas();
    renderLetterTarget(c, L);
    assert.equal(c.ctx._count('stroke'), 1, `${L}: skeleton not stroked once`);
    assert.equal(c.ctx._count('arc'), 21, `${L}: joint dots != 21`);
    const segs = c.ctx._calls.filter((k) => k.name === 'lineTo');
    assert.equal(segs.length, BONES, `${L}: bone count`);
    for (const k of segs) {
      const [x, y] = k.args;
      assert.ok(x >= 0 && x <= c.width && y >= 0 && y <= c.height, `${L}: point (${x},${y}) outside canvas`);
    }
  }
});

test('geometry y-up is flipped into canvas y-down', () => {
  // Same bone list as render.js: points are drawn as moveTo(pts[a]) lineTo(pts[b])
  // in this exact order, so call i of each kind maps to bone i's endpoints.
  const CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
    [0, 5], [5, 6], [6, 7], [7, 8],           // index
    [5, 9], [9, 10], [10, 11], [11, 12],      // middle
    [9, 13], [13, 14], [14, 15], [15, 16],    // ring
    [13, 17], [17, 18], [18, 19], [19, 20],   // pinky
    [0, 17],                                   // palm base
  ];
  const c = recordingCanvas();
  renderLetterTarget(c, 'L');
  const moves = c.ctx._calls.filter((k) => k.name === 'moveTo');
  const lines = c.ctx._calls.filter((k) => k.name === 'lineTo');
  const pts = {};
  CONNECTIONS.forEach(([a, b], i) => {
    pts[a] = { x: moves[i].args[0], y: moves[i].args[1] };
    pts[b] = { x: lines[i].args[0], y: lines[i].args[1] };
  });
  const lm = canonicalLandmarks('L');
  const geoTop = lm.reduce((bi, p, i) => (p.y > lm[bi].y ? i : bi), 0); // fingertip
  const geoBottom = lm.reduce((bi, p, i) => (p.y < lm[bi].y ? i : bi), 0); // wrist
  assert.ok(pts[geoTop].y < pts[geoBottom].y, 'highest geometry point must map to the smallest canvas y');
});
