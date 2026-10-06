// Movement-letter (J/Z) trajectory classifier tests. The MotionTracker is fed
// synthetic raw-camera-space paths: signer-view glyphs mirrored into camera
// space, rendered as per-frame landmark frames (only lm 0/8/9/20 are read).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionTracker, classifyPath, MIN_PATH, START_SPEED } from '../js/motion.js';
import { MOTION_STROKES } from '../js/geometry.js';

// Camera space = horizontal mirror of signer space (the raw webcam image).
const toCamera = (stroke) => stroke.map(([x, y]) => [1 - x, y]);

// Render a stroke (in palm units) into per-frame MotionTracker feeds.
// Palm: wrist at (0.5, 0.5), middle-MCP at (0.6, 0.5) => palm length 0.1 in
// normalized image coords, so 1 palm unit = 0.1 image units.
function makeLm(idx, pnk) {
  const lm = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5 }));
  lm[9] = { x: 0.6, y: 0.5 };
  lm[8] = { x: 0.5 + idx[0] * 0.1, y: 0.5 + idx[1] * 0.1 };
  lm[20] = { x: 0.5 + pnk[0] * 0.1, y: 0.5 + pnk[1] * 0.1 };
  return lm;
}

// mulberry32 — same PRNG convention as classifier.js perturb().
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t ^ (t >>> 7) | 0) / 1;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Feed a stroke through the tracker; returns the list of emitted letters.
// stroke: camera-space path in palm units; speed in palm units/s.
function trace(stroke, { scale = 1, jitter = 0, seed = 1, speed = 2.2, fps = 30, mirror = false } = {}) {
  const rand = mulberry(seed);
  const path = stroke.map(([x, y]) => [x * scale + (rand() * 2 - 1) * jitter, y * scale + (rand() * 2 - 1) * jitter]);
  if (mirror) for (const p of path) p[0] = -p[0];
  // resample the path into evenly spaced frames at the requested drawing speed
  const step = (speed / fps); // palm units per frame
  let acc = 0;
  const frames = [];
  const cur = path[0].slice();
  frames.push(cur.slice());
  const emit = (p) => frames.push(p.slice());
  for (let i = 1; i < path.length; i++) {
    let [x0, y0] = cur;
    let [x1, y1] = path[i];
    let segLen = Math.hypot(x1 - x0, y1 - y0);
    while (segLen >= step) {
      const t = step / segLen;
      cur[0] += (x1 - cur[0]) * t;
      cur[1] += (y1 - cur[1]) * t;
      emit(cur);
      [x0, y0] = cur;
      segLen = Math.hypot(x1 - x0, y1 - y0);
      acc = 0;
    }
  }
  const t = new MotionTracker();
  const emitted = [];
  let ms = 0;
  const still = makeLm(cur, [0.4, 0.35]); // both fingertips resting on the fist
  for (const f of frames) {
    ms += 1000 / fps;
    const lm = makeLm(f, [0.4, 0.35]); // pinky parked; the moving finger drives
    const r = t.feed(lm, ms);
    if (r) emitted.push(r.letter);
  }
  // hold still past QUIET_MS so the stroke is judged
  for (let i = 0; i < 12; i++) {
    ms += 1000 / fps;
    const r = t.feed(still, ms);
    if (r) emitted.push(r.letter);
  }
  return emitted;
}

const J_CAM = toCamera(MOTION_STROKES.J).map(([x, y]) => [x * 2 - 1, y * 2 - 0.9]); // ~2 palm units tall
const Z_CAM = toCamera(MOTION_STROKES.Z).map(([x, y]) => [x * 2.4 - 1.2, y * 2.4 - 1.2]);

test('a traced Z is recognized', () => {
  const got = trace(Z_CAM, { seed: 2 });
  assert.ok(got.includes('Z'), `expected Z, got ${JSON.stringify(got)}`);
});

test('a traced J is recognized', () => {
  const got = trace(J_CAM, { seed: 3 });
  assert.ok(got.includes('J'), `expected J, got ${JSON.stringify(got)}`);
});

test('strokes survive scale change and small jitter', () => {
  assert.ok(trace(Z_CAM, { scale: 0.75, jitter: 0.01, seed: 4 }).includes('Z'));
  assert.ok(trace(J_CAM, { scale: 1.35, jitter: 0.012, seed: 5 }).includes('J'));
});

test('a stationary hand emits nothing', () => {
  const t = new MotionTracker();
  const still = makeLm([0.35, 0.4], [0.4, 0.35]);
  let ms = 0;
  for (let i = 0; i < 90; i++) {
    ms += 33;
    const r = t.feed(still, ms);
    assert.equal(r, null, `emitted ${JSON.stringify(r)} on a still hand`);
  }
});

test('a scribble shorter than MIN_PATH is ignored', () => {
  const tiny = [[0, 0], [0.15, 0.05], [0.3, 0], [0.45, 0.05]];
  const got = trace(tiny, { seed: 6 });
  assert.deepEqual(got, [], `short scribble emitted ${JSON.stringify(got)}`);
});

test('classifyPath rejects paths that are too short to judge', () => {
  assert.equal(classifyPath([[0, 0], [0.1, 0], [0.2, 0]]), null);
  assert.equal(classifyPath(null), null);
});

test('classifyPath is direction-aware: reversed Z is not a Z', () => {
  const reversed = Z_CAM.slice().reverse();
  const fwd = classifyPath(Z_CAM);
  const rev = classifyPath(reversed);
  assert.equal(fwd.letter, 'Z');
  assert.ok(!(rev && rev.letter === 'Z' && rev.score <= fwd.score), 'reversed Z scored better than a real Z');
});

test('a full trace emits exactly once, then cools down', () => {
  const t = new MotionTracker();
  let ms = 0;
  const path = Z_CAM;
  const step = 2.2 / 30;
  const cur = path[0].slice();
  const emissions = [];
  const feedFrame = (idx, pnk) => {
    ms += 33;
    const r = t.feed(makeLm(idx, pnk), ms);
    if (r) emissions.push(r.letter);
  };
  feedFrame(cur, [0.4, 0.35]);
  for (let i = 1; i < path.length; i++) {
    let guard = 0;
    while (Math.hypot(path[i][0] - cur[0], path[i][1] - cur[1]) >= step && guard++ < 200) {
      const d = Math.hypot(path[i][0] - cur[0], path[i][1] - cur[1]);
      cur[0] += ((path[i][0] - cur[0]) / d) * step;
      cur[1] += ((path[i][1] - cur[1]) / d) * step;
      feedFrame(cur, [0.4, 0.35]);
    }
    cur[0] = path[i][0];
    cur[1] = path[i][1];
    feedFrame(cur, [0.4, 0.35]);
  }
  for (let i = 0; i < 12; i++) feedFrame(cur, [0.4, 0.35]);
  const zCount = emissions.filter((l) => l === 'Z').length;
  assert.equal(zCount, 1, `expected exactly one Z emission, got ${JSON.stringify(emissions)}`);
  // immediate re-trace inside the cooldown window stays silent
  const r = t.feed(makeLm(cur, [0.4, 0.35]), ms + 33);
  assert.equal(r, null);
});

test('MIN_PATH and START_SPEED are sane relative to the stroke sizes', () => {
  // the camera-space strokes must comfortably exceed the minimum path length
  const len = (p) => {
    let s = 0;
    for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    return s;
  };
  assert.ok(len(Z_CAM) > MIN_PATH * 1.2, `Z stroke ${len(Z_CAM).toFixed(2)} too short vs MIN_PATH ${MIN_PATH}`);
  assert.ok(len(J_CAM) > MIN_PATH * 1.2, `J stroke ${len(J_CAM).toFixed(2)} too short vs MIN_PATH ${MIN_PATH}`);
  assert.ok(START_SPEED < 3, 'start speed should stay reachable for a deliberate trace');
});
