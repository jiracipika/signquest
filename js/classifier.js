// Deterministic ASL static-letter classifier over MediaPipe-style 21-landmark
// hands.
//
// Approach: scale/rotation/translation/handedness-INVARIANT features + nearest
// prototype matching. DATASET-GROUNDED (2026-10-05): prototypes are k-means
// centroids (6/letter) over 3,120 real landmark samples extracted with the
// same MediaPipe hand_landmarker model from the Hugging Face dataset
// Marxulia/asl_sign_languages_alphabets_v03, whitened per feature dim.
// Held-out accuracy 85.2% vs 40.6% for the previous hand-authored canonical
// prototypes. Regenerate with scripts/build-prototypes.mjs. J and Z are
// movement letters — they are recognized by js/motion.js, not here.
import PROTOTYPES, { SCALE } from './prototypes.js';
import { canonicalLandmarks } from './geometry.js';

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const FINGER_CHAINS = {
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};
const THUMB_CHAIN = [1, 2, 3, 4];
// Reference MCP for the metacarpal direction of each finger's MCP curl term.
const MCP_NEIGHBOR = { index: 9, middle: 13, ring: 17, pinky: 13 };

const sub = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const dist = (a, b) => norm(sub(a, b));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => {
  const n = norm(v);
  return n < 1e-9 ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n];
};

// Interior angle at joint j (b is the vertex), radians.
function jointAngle(a, b, c) {
  const u = sub(a, b), v = sub(c, b);
  const nu = norm(u), nv = norm(v);
  if (nu < 1e-6 || nv < 1e-6) return Math.PI;
  return Math.acos(Math.min(1, Math.max(-1, dot3(u, v) / (nu * nv))));
}

// Total flexion of a 4-point chain: sum of (PI - interior angle) at its PIP
// and DIP joints. MCP flexion has its own term (mcpCurl below) because the
// chain's first segment starts at the MCP — there is no proximal segment
// inside the chain to form that angle.
function chainCurl(chain, lm) {
  let s = 0;
  for (let i = 1; i <= 2; i++) s += Math.PI - jointAngle(lm[chain[i - 1]], lm[chain[i]], lm[chain[i + 1]]);
  return s;
}

// Flexion at the MCP: angle between the metacarpal direction (approximated by
// the neighbor-MCP direction) and the MCP->PIP segment. Separates knuckles-up
// postures (B, F) from folded-knuckle postures (M, N, E) far better than tip
// position alone.
function mcpCurl(mcp, neighborMcp, pip, lm) {
  return Math.PI - jointAngle(lm[neighborMcp], lm[mcp], lm[pip]);
}

// Direction of a chain's proximal segment, palm-frame normalized.
function chainDir(chain, lm) {
  return unit(sub(lm[chain[1]], lm[chain[0]]));
}

// Extract invariant features. Returns null for degenerate input.
//
// Palm frame: origin at wrist, +y toward middle-MCP, +z along palm normal,
// +x completing a right-handed frame (points from middle-MCP toward... whichever
// side; sign is canonicalized below so left/right hands produce identical features).
export function extractFeatures(lm) {
  for (const p of lm) if (!p || !isFinite(p.x + p.y + p.z)) return null;

  const wrist = lm[0];
  const palmW = dist(lm[5], lm[17]);
  if (palmW < 1e-6) return null;

  const n = unit(cross(sub(lm[5], wrist), sub(lm[17], wrist)));
  if (!n[0] && !n[1] && !n[2]) return null;
  const yAxis = unit(sub(lm[9], wrist));
  if (!yAxis[0] && !yAxis[1] && !yAxis[2]) return null;
  const xAxis = unit(cross(yAxis, n));

  // Project into palm frame. Mirror-canonicalize: a real right hand and a real
  // left hand must give the same features, so flip x when the pinky MCP lands
  // on the negative-x side (left-hand geometry, or palm-away viewing).
  let pts = lm.map((p) => {
    const v = sub(p, wrist);
    return [dot3(v, xAxis) / palmW, dot3(v, yAxis) / palmW, dot3(v, n) / palmW];
  });
  if (pts[17][0] < 0) {
    pts = pts.map((p) => [-p[0], p[1], p[2]]);
  }

  const f = { fingers: {}, pinch: FINGERS.map((fg) => dist(lm[4], lm[FINGER_CHAINS[fg][3]]) / palmW) };
  for (const fg of FINGERS) {
    const ch = FINGER_CHAINS[fg];
    f.fingers[fg] = {
      curl: chainCurl(ch, lm),
      mcp: mcpCurl(ch[0], MCP_NEIGHBOR[fg], ch[1], lm),
      dir: chainDir(ch, lm),
      tip: pts[ch[3]],
    };
  }
  f.thumb = {
    curl: chainCurl(THUMB_CHAIN, lm),
    mcp: mcpCurl(THUMB_CHAIN[0], 5, THUMB_CHAIN[1], lm),
    dir: chainDir(THUMB_CHAIN, lm),
    tip: pts[4],
  };
  f._pts = pts;
  return f;
}

// ---- prototype matching ----
// Feature vector layout (with weights): discriminative emphasis on thumb
// placement and pinch distances (these separate the fist family M/N/T/S/A and
// the pinch family F/O/D), curls separate extended vs closed postures. The
// per-letter prototype sets live in prototypes.js (dataset-derived, whitened);
// SCALE whitens each dim so the query vector is compared in the same space.
const CURL_W = 1.2;
const MCP_W = 1.0;
const TIP_W = 0.55;
const THUMB_TIP_W = 1.0;
const PINCH_W = 0.9;

export function featureVector(f) {
  const v = [];
  for (const fg of FINGERS) {
    v.push(f.fingers[fg].curl * CURL_W);
    v.push(f.fingers[fg].mcp * MCP_W);
    v.push(...f.fingers[fg].tip.map((c) => c * TIP_W));
  }
  v.push(f.thumb.curl * CURL_W);
  v.push(f.thumb.mcp * MCP_W);
  v.push(...f.thumb.tip.map((c) => c * THUMB_TIP_W));
  for (const p of f.pinch) v.push(p * PINCH_W);
  return v;
}

function sqdist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

// Whitened query vector — prototypes in prototypes.js are stored pre-whitened.
function whitenedVector(f) {
  const v = featureVector(f);
  for (let i = 0; i < v.length; i++) v[i] /= SCALE[i] || 1;
  return v;
}

// Classify: returns { letter, distance, scores: {letter: distance}, features }.
// distance is a root-mean-square distance in weighted feature space; ~0 means
// an essentially ideal rendition of the letter.
export function classify(lm) {
  const f = extractFeatures(lm);
  if (!f) return null;
  const v = whitenedVector(f);
  const scores = {};
  let best = null;
  for (const p of PROTOTYPES) {
    const d = Math.sqrt(sqdist(v, p.vec) / v.length);
    scores[p.letter] = d;
    if (best === null || d < best.distance) best = { letter: p.letter, distance: d };
  }
  return { letter: best.letter, distance: best.distance, scores, features: f };
}

// Confidence heuristic for the UI: how much closer the winner is than runner-up.
export function margin(result) {
  if (!result) return 0;
  const sorted = Object.values(result.scores).sort((a, b) => a - b);
  return sorted[1] - sorted[0];
}

// Smoothed classifier: majority vote over the last N frames — how the app uses it.
//
// Flicker policy (BUGFIX 2026-10-05): a single no-hand frame used to wipe the
// whole window, so with intermittent detection the vote never accumulated and
// the "absorbs flicker" claim only held for continuous detection. Now `grace`
// consecutive no-hand frames are tolerated while HOLDING the current vote;
// only sustained absence past the grace window resets, so a newly presented
// letter is never polluted by the old one.
export class SmoothedClassifier {
  constructor(n = 9, grace = 3) {
    this.n = n;
    this.grace = grace;
    this.buf = [];
    this._absent = 0;
  }
  push(result) {
    this._absent = 0; // a detected hand restarts the absence grace counter
    if (!result) return null;
    this.buf.push(result.letter);
    if (this.buf.length > this.n) this.buf.shift();
    return { ...this._vote(), frame: result };
  }
  // A frame where no hand was detected. Within the grace window the current
  // vote is held (and returned); past it the window resets. Returns null once
  // the window is (or already was) empty.
  absent() {
    if (this.buf.length === 0) return null;
    if (++this._absent > this.grace) {
      this.reset();
      return null;
    }
    return this._vote();
  }
  reset() {
    this.buf = [];
    this._absent = 0;
  }
  _vote() {
    const counts = {};
    for (const L of this.buf) counts[L] = (counts[L] || 0) + 1;
    let best = null;
    for (const [L, c] of Object.entries(counts)) {
      // BUGFIX (2026-09-29): the comparison read `best.c` — a property the
      // assignment never writes (`count`) — so best NEVER updated after the
      // first key and the vote always returned the window's OLDEST letter.
      // Majority voting now actually votes.
      if (!best || c > best.count) best = { letter: L, count: c };
    }
    return { letter: best.letter, agreement: best.count / this.buf.length };
  }
}

// ---- test helpers ----
export function letterToLandmarks(letter) {
  return canonicalLandmarks(letter);
}

// Affine perturbation for tests: rotate in-plane, scale, jitter each point.
export function perturb(lm, { angle = 0, scale = 1, jitter = 0, seed = 1 } = {}) {
  const rand = mulberry(seed);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return lm.map((p) => {
    const jx = jitter ? (rand() * 2 - 1) * jitter : 0;
    const jy = jitter ? (rand() * 2 - 1) * jitter : 0;
    const jz = jitter ? (rand() * 2 - 1) * jitter : 0;
    const x = (p.x + jx) * scale, y = (p.y + jy) * scale, z = (p.z + jz) * scale;
    return { x: x * cos - y * sin, y: x * sin + y * cos, z };
  });
}
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
