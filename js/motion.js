// Movement letters J and Z: trajectory classification over image-space
// fingertip paths.
//
// The static classifier (classifier.js) only sees instantaneous shapes, so the
// two ASL letters that ARE motion — J (pinky traces a J) and Z (index traces a
// Z) — were unrecognized. This module watches a fingertip path in raw camera
// coordinates (selfie-mirrored display does not affect landmark space),
// normalizes it to be translation/scale invariant with modest rotation
// tolerance, and matches it against stroke prototypes by mean segment-angle
// difference.
//
// Camera-space note: the signer draws the glyph as it reads FROM THEIR VIEW;
// the raw camera image is its horizontal mirror, so the prototypes here are
// the mirrored glyphs (J_HOOK_FLIP / Z_SEGMENTS_FLIP in geometry terms).
//
// Pure and deterministic: no DOM, no MediaPipe — the app feeds landmark arrays
// per frame; Node tests feed synthetic paths.
import { MOTION_STROKES } from './geometry.js';

// Stroke prototypes in SIGNER view (what the letter should look like to the
// reader — geometry.js MOTION_STROKES), unit square, y-down screen convention.
// Mirrored at build time into camera space below.

// Camera space = horizontal mirror of signer space.
function toCameraSpace(stroke) {
  return stroke.map(([x, y]) => [1 - x, y]);
}

const RESAMPLE_N = 16; // points per resampled path (15 direction segments)
const SEGMENTS = RESAMPLE_N - 1;

function resample(path, n) {
  if (path.length < 2) return path.slice();
  const lens = [0];
  for (let i = 1; i < path.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  }
  const total = lens[lens.length - 1];
  if (total < 1e-9) return new Array(n).fill(path[0].slice());
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < lens.length - 2 && lens[j + 1] < target) j++;
    const seg = lens[j + 1] - lens[j];
    const t = seg < 1e-9 ? 0 : (target - lens[j]) / seg;
    out.push([
      path[j][0] + (path[j + 1][0] - path[j][0]) * t,
      path[j][1] + (path[j + 1][1] - path[j][1]) * t,
    ]);
  }
  return out;
}

function pathLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

// Unit-normalize: origin at path start, scale by the bounding-box diagonal.
// Translation/scale invariant, NOT rotation invariant (a Z rotated 90° is an N).
function normalizePath(path) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of path) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const diag = Math.max(Math.hypot(maxX - minX, maxY - minY), 1e-9);
  return path.map(([x, y]) => [(x - minX) / diag, (y - minY) / diag]);
}

// Direction-angle sequence of a resampled path.
function dirSeq(path) {
  const seq = [];
  for (let i = 1; i < path.length; i++) {
    seq.push(Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]));
  }
  return seq;
}

const PROTOTYPES = Object.entries(MOTION_STROKES).map(([letter, stroke]) => ({
  letter,
  seq: dirSeq(normalizePath(resample(toCameraSpace(stroke), RESAMPLE_N))),
}));

function scoreAgainst(path, proto) {
  const seq = dirSeq(path);
  let s = 0;
  for (let i = 0; i < seq.length; i++) {
    let d = seq[i] - proto.seq[i];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    s += Math.abs(d);
  }
  return s / seq.length; // mean absolute angular difference, radians
}

// Rotate a normalized path by `ang` around its centroid — rotation-tolerance
// search for signers whose hand/wrist orientation differs from the prototype.
function rotatePath(path, ang) {
  let cx = 0, cy = 0;
  for (const [x, y] of path) { cx += x; cy += y; }
  cx /= path.length; cy /= path.length;
  const c = Math.cos(ang), s = Math.sin(ang);
  return path.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  });
}

const ROTATIONS = [0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6]; // ±15°, ±30°

export function classifyPath(pathRaw) {
  if (!pathRaw || pathRaw.length < 2) return null;
  const norm = normalizePath(resample(pathRaw, RESAMPLE_N));
  let best = null;
  for (const p of PROTOTYPES) {
    for (const ang of ROTATIONS) {
      const score = scoreAgainst(rotatePath(norm, ang), p);
      if (!best || score < best.score) best = { letter: p.letter, score };
    }
  }
  return best && best.score < 0.5 ? best : null;
}

// ---- the app-facing tracker --------------------------------------------------
//
// Feeds per-frame landmarks; emits J/Z when a fingertip finishes tracing a
// stroke. Policy:
// - the moving finger is picked by the letter being attempted: index tip (lm 8)
//   for Z, pinky tip (lm 20) for J. The OTHER finger must stay quiet — J/Z are
//   signed from a fist, so a wildly moving second finger means this is just
//   hand travel, not a glyph.
// - palm length |lm0 -> lm9| normalizes image scale per frame.
// - tracing starts when the finger speed exceeds START_SPEED (palm units/s),
//   accumulates while active, and the stroke is judged after QUIET_MS of low
//   speed, provided the traced path is long enough to be a glyph and short
//   enough to be one gesture.
export const START_SPEED = 0.9;   // palm units per second
export const ACTIVE_SPEED = 0.55; // keep tracing above this
export const QUIET_MS = 260;      // low-speed time that ends a stroke
export const MIN_PATH = 1.1;      // palm units — shorter is noise
export const MAX_PATH = 9.0;      // palm units — longer is hand travel
export const COOLDOWN_MS = 700;   // dead time after an emitted letter

export class MotionTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.buf = [];          // [{ t, x, y }] in palm units (camera space)
    this.tracing = false;
    this.quietSince = null;
    this.lastT = null;
    this.lastIdx = null;    // previous-frame tip positions — speed reference
    this.lastPnk = null;    // (kept even while idle so tracing can START)
    this.cooldownUntil = 0;
  }

  // lm: 21 landmarks {x,y} in RAW camera coords. t: ms timestamp.
  // Returns { letter, score, path } when a stroke completes, else null.
  feed(lm, t) {
    if (!lm || !isFinite(t)) return null;
    const palm = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
    if (palm < 1e-6) return null;
    if (t < this.cooldownUntil) return null;

    const idx = { x: (lm[8].x - lm[0].x) / palm, y: (lm[8].y - lm[0].y) / palm };
    const pnk = { x: (lm[20].x - lm[0].x) / palm, y: (lm[20].y - lm[0].y) / palm };

    let result = null;
    if (this.lastT !== null && this.lastIdx) {
      const dt = Math.max(1, t - this.lastT) / 1000;
      // speeds vs the PREVIOUS frame's tips (not the buffer — an idle hand has
      // no buffer yet, and that's exactly when a stroke needs to start)
      const spdI = Math.hypot(idx.x - this.lastIdx.x, idx.y - this.lastIdx.y) / dt;
      const spdP = Math.hypot(pnk.x - this.lastPnk.x, pnk.y - this.lastPnk.y) / dt;
      // Which finger is driving? The faster one is the candidate writer; the
      // other must stay below the start threshold (a fist drawing a glyph).
      const driverFaster = spdI >= spdP;
      const driver = driverFaster ? 'z' : 'j';
      const spd = driverFaster ? spdI : spdP;
      const other = driverFaster ? spdP : spdI;

      if (!this.tracing) {
        if (spd >= START_SPEED && other < START_SPEED) {
          this.tracing = true;
          this.driver = driver;
          this.buf = [{ t, ...(driverFaster ? idx : pnk) }];
          this.quietSince = null;
        }
      } else if (this.driver !== driver && other >= START_SPEED) {
        // the "other" finger took over — not a glyph, restart watching
        this.reset();
      } else {
        const tip = driverFaster ? idx : pnk;
        const last = this.buf[this.buf.length - 1];
        if (spd >= ACTIVE_SPEED || Math.hypot(tip.x - last.x, tip.y - last.y) > 0.01) {
          this.buf.push({ t, x: tip.x, y: tip.y });
          this.quietSince = null;
        } else {
          if (this.quietSince === null) this.quietSince = t;
          if (t - this.quietSince >= QUIET_MS) result = this._judge(t);
        }
        if (this.buf.length > 240) result = this._judge(t); // pathological buffer
      }
    }
    this.lastT = t;
    this.lastIdx = idx;
    this.lastPnk = pnk;
    return result;
  }

  _speed(pt, dt) {
    const last = this.buf[this.buf.length - 1];
    return Math.hypot(pt.x - last.x, pt.y - last.y) / dt;
  }

  // Live traced length in palm units — the practice UI maps this to hold-bar
  // progress for J/Z (the static classifier's hold semantics do not apply).
  get livePathLength() {
    return pathLength(this.buf.map((p) => [p.x, p.y]));
  }

  _judge(t) {
    const path = this.buf.map((p) => [p.x, p.y]);
    const len = pathLength(path);
    this.reset();
    this.cooldownUntil = t + COOLDOWN_MS;
    if (len < MIN_PATH || len > MAX_PATH) return null;
    const best = classifyPath(path);
    return best ? { letter: best.letter, score: best.score, length: len } : null;
  }
}
