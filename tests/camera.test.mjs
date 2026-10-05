// HandTracker decision-layer tests: the per-frame loop decisions, smoothing
// integration (_handleResults), lifecycle guards (start/stop) and the GPU->CPU
// fallback. The webcam, MediaPipe wasm and rAF timing are hardware/browser —
// what we test here is the pure DECISION logic around them, with stubs.
//
// No new dependencies: everything is stubbed with plain objects, following the
// existing node:test + assert/strict conventions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HandTracker } from '../js/camera.js';
import { canonicalLandmarks } from '../js/geometry.js';

// ---- stub helpers ----------------------------------------------------------

function recordingCtx() {
  const calls = [];
  const ctx = { lineWidth: 0, strokeStyle: '', fillStyle: '', lineCap: '' };
  for (const m of ['clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill']) {
    ctx[m] = (...args) => calls.push({ name: m, args });
  }
  ctx._calls = calls;
  ctx._count = (name) => calls.filter((c) => c.name === name).length;
  return ctx;
}

function fakeCanvas(ctx) {
  return { width: 640, height: 480, getContext: () => ctx };
}

function fakeVideo({ readyState = 2, videoWidth = 640, videoHeight = 480 } = {}) {
  return { readyState, videoWidth, videoHeight, srcObject: null, play: async () => {} };
}

function fakeLandmarker(detect) {
  let closed = 0;
  return {
    detectForVideo: detect,
    close() { closed++; },
    get closedCount() { return closed; },
  };
}

// Controllable rAF: frames only advance when a test calls pump().
function fakeRaf() {
  const queue = [];
  let cancelled = 0;
  globalThis.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  globalThis.cancelAnimationFrame = () => { cancelled++; };
  return {
    queue,
    get pending() { return queue.length; },
    get cancelled() { return cancelled; },
    pump: () => { const cb = queue.shift(); if (cb) cb(); },
  };
}

function fakeStream() {
  let stopped = 0;
  const track = { stop: () => { stopped++; } };
  return { stream: { getTracks: () => [track] }, get stopped() { return stopped; } };
}

function installNavigator(setup) {
  const calls = [];
  const args = [];
  const getUserMedia = async (constraints) => {
    calls.push(1);
    args.push(constraints);
    return setup();
  };
  getUserMedia._calls = () => calls.length;
  getUserMedia._args = () => args;
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia } },
    configurable: true,
  });
  return getUserMedia;
}

// HandTracker with the CDN/model wiring stubbed out (Node cannot import the
// https:// vision bundle). Everything else — loop, fallback, stop — is real.
class TestTracker extends HandTracker {
  constructor(landmarker) {
    super();
    this._stubLandmarker = landmarker;
    this._createCalls = [];
  }
  async _createLandmarker(delegate) {
    this._createCalls.push(delegate);
    if (this._stubLandmarker instanceof Error) throw this._stubLandmarker;
    return this._stubLandmarker;
  }
}

function startedTracker(t, { detect, video, overlay } = {}) {
  const raf = fakeRaf();
  const cam = fakeStream();
  installNavigator(() => cam.stream);
  return Promise.resolve().then(async () => {
    await t.start(video || fakeVideo(), overlay || fakeCanvas(recordingCtx()));
    return { raf, cam };
  });
}

// ---- start() lifecycle ------------------------------------------------------

test('start requests the camera, attaches the stream and begins the loop', async () => {
  const t = new TestTracker(fakeLandmarker(() => ({ landmarks: [] })));
  const raf = fakeRaf();
  const cam = fakeStream();
  const gum = installNavigator(() => cam.stream);
  const video = fakeVideo();
  const ctx = recordingCtx();
  const overlay = fakeCanvas(ctx);

  await t.start(video, overlay);

  assert.equal(t.running, true);
  assert.equal(video.srcObject, cam.stream);
  assert.equal(gum._calls(), 1);
  assert.deepEqual(gum._args()[0], {
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  // one frame scheduled; the landmarker was built via the (stubbed) GPU path
  assert.equal(raf.pending, 1);
  assert.deepEqual(t._createCalls, ['GPU']);

  // pump one frame: video is ready -> overlay gets sized, onResult fires
  const seen = [];
  t.onResult = (info) => seen.push(info);
  raf.pump();
  assert.deepEqual([overlay.width, overlay.height], [640, 480]);
  assert.deepEqual(seen, [{ hand: false }]);
  assert.equal(raf.pending, 1); // loop keeps itself alive
});

test('start retries landmarker creation on CPU when the GPU build fails', async () => {
  class GpuFailsTracker extends HandTracker {
    constructor() { super(); this.calls = []; }
    async _createLandmarker(delegate) {
      this.calls.push(delegate);
      if (delegate === 'GPU') throw new Error('no WebGL');
      return fakeLandmarker(() => ({ landmarks: [] }));
    }
  }
  const t = new GpuFailsTracker();
  const { raf } = await startedTracker(t);
  assert.deepEqual(t.calls, ['GPU', 'CPU']); // automatic creation-time fallback
  assert.equal(t.running, true);
  assert.equal(raf.pending, 1);
});

test('start surfaces the friendly error when the library cannot load', async () => {
  const t = new TestTracker(new Error('Could not load the hand-tracking library (check your internet connection).'));
  fakeRaf();
  installNavigator(() => fakeStream().stream);
  await assert.rejects(t.start(fakeVideo(), fakeCanvas(recordingCtx())), /check your internet connection/);
  assert.equal(t.running, false); // never entered the loop
});

test('start rejects with the permission error when getUserMedia is denied', async () => {
  const t = new TestTracker(fakeLandmarker(() => ({ landmarks: [] })));
  fakeRaf();
  const err = new Error('denied');
  err.name = 'NotAllowedError';
  installNavigator(() => { throw err; });
  await assert.rejects(t.start(fakeVideo(), fakeCanvas(recordingCtx())), (e) => e.name === 'NotAllowedError');
  assert.equal(t.running, false); // never entered the loop
});

test('start is a no-op while already running', async () => {
  const t = new TestTracker(fakeLandmarker(() => ({ landmarks: [] })));
  const raf = fakeRaf();
  const gum = installNavigator(() => fakeStream().stream);
  await t.start(fakeVideo(), fakeCanvas(recordingCtx()));
  await t.start(fakeVideo(), fakeCanvas(recordingCtx())); // second call must bail
  assert.equal(gum._calls(), 1);
  assert.equal(raf.pending, 1); // no second loop
});

// ---- the rAF loop decisions -------------------------------------------------

test('loop skips detection until the video has frames, but stays alive', async () => {
  let detects = 0;
  const t = new TestTracker(fakeLandmarker(() => { detects++; return { landmarks: [] }; }));
  const video = fakeVideo({ readyState: 0, videoWidth: 0 });
  const { raf } = await startedTracker(t, { video });
  raf.pump();
  raf.pump();
  assert.equal(detects, 0); // nothing to detect on a cold video element
  assert.equal(raf.pending, 1); // ...but the loop still reschedules
});

test('detect timestamps are strictly monotonic even when the clock stalls', async () => {
  const tsLog = [];
  const t = new TestTracker(fakeLandmarker((v, ts) => { tsLog.push(ts); return { landmarks: [] }; }));
  const raf = fakeRaf();
  const cam = fakeStream();
  installNavigator(() => cam.stream);
  await t.start(fakeVideo(), fakeCanvas(recordingCtx()));
  // Pretend a previous session already stamped far into the future: the loop
  // must not send a non-increasing timestamp to detectForVideo (VIDEO mode
  // requirement).
  t._lastTs = performance.now() + 1e6;
  raf.pump();
  raf.pump();
  raf.pump();
  assert.equal(tsLog.length, 3);
  for (let i = 1; i < tsLog.length; i++) assert.ok(tsLog[i] > tsLog[i - 1], `ts ${i} not increasing`);
});

// THE PIN (2026-10-05): a detect-time GPU failure used to freeze the loop
// forever — the catch handler triggered the CPU rebuild and `return`ed without
// rescheduling rAF, and _restartWithCpu never restarted the loop either. After
// the CPU landmarker finishes building, detection MUST resume.
test('after a detect-time GPU failure the loop resumes on the CPU landmarker', async () => {
  let gpuAttempts = 0;
  const gpuLm = fakeLandmarker(() => { gpuAttempts++; throw new Error('GPU kernel failed'); });
  const seen = [];
  const t = new TestTracker(gpuLm);
  const raf = fakeRaf();
  installNavigator(() => fakeStream().stream);
  const video = fakeVideo();
  const overlay = fakeCanvas(recordingCtx());
  await t.start(video, overlay);
  t.onResult = (info) => seen.push(info);
  // Stub only the CDN rebuild: pretend the CPU landmarker finished building.
  const cpuLm = fakeLandmarker(() => ({ landmarks: [canonicalLandmarks('A')] }));
  t._restartWithCpu = async () => { t.landmarker = cpuLm; };

  raf.pump(); // GPU frame: detect throws -> fallback path
  assert.equal(gpuAttempts, 1);
  await new Promise((r) => setImmediate(r)); // let the rebuild promise settle

  assert.equal(raf.pending, 1); // <-- FAILS on the frozen-loop code: nothing rescheduled
  raf.pump(); // first CPU frame
  assert.equal(seen.length, 1);
  assert.equal(seen[0].hand, true);
  assert.equal(seen[0].letter, 'A'); // detection actually works again
});

test('CPU rebuild failure reports an error and does not resume the loop', async () => {
  const t = new TestTracker(fakeLandmarker(() => { throw new Error('GPU kernel failed'); }));
  const raf = fakeRaf();
  installNavigator(() => fakeStream().stream);
  await t.start(fakeVideo(), fakeCanvas(recordingCtx()));
  const errs = [];
  t.onError = (m) => errs.push(m);
  t._restartWithCpu = async () => { t.running = false; errs.push('CPU fallback failed: no net'); };
  raf.pump();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errs, ['CPU fallback failed: no net']);
  assert.equal(raf.pending, 0); // stopped trackers must not resurrect the loop
});

test('a second detect failure reports an error and keeps the loop alive', async () => {
  const t = new TestTracker(fakeLandmarker(() => { throw new Error('boom'); }));
  const raf = fakeRaf();
  installNavigator(() => fakeStream().stream);
  await t.start(fakeVideo(), fakeCanvas(recordingCtx()));
  const errs = [];
  t.onError = (m) => errs.push(m);
  t._fellBackToCpu = true; // fallback already happened; no more rebuilds
  raf.pump();
  raf.pump();
  assert.equal(errs.length, 2);
  assert.match(errs[0], /detection error: boom/);
  assert.equal(raf.pending, 1); // error is reported, loop continues
});

// ---- _handleResults: the per-frame decision ---------------------------------

test('hand frame: normalizes to canvas pixels, draws skeleton, smooths, reports', () => {
  const t = new HandTracker();
  const ctx = recordingCtx();
  const overlay = fakeCanvas(ctx);
  const seen = [];
  t.onResult = (info) => seen.push(info);

  const lmNorm = canonicalLandmarks('A');
  t._handleResults({ landmarks: [lmNorm] }, ctx, overlay);

  const info = seen[0];
  assert.equal(info.hand, true);
  assert.equal(info.letter, 'A');
  assert.equal(info.agreement, 1); // first frame: unanimous window
  assert.ok(isFinite(info.distance) && info.distance >= 0);
  assert.ok(info.margin > 0);
  // overlay drawn: cleared once, one skeleton stroke, 21 joint dots
  assert.equal(ctx._count('clearRect'), 1);
  assert.equal(ctx._count('stroke'), 1);
  assert.equal(ctx._count('arc'), 21);

  // a second identical frame keeps the majority at full agreement
  t._handleResults({ landmarks: [lmNorm] }, ctx, overlay);
  assert.equal(seen[1].agreement, 1);
});

test('no-hand frame clears the canvas, resets the smoother, reports hand:false', () => {
  const t = new HandTracker();
  const ctx = recordingCtx();
  const overlay = fakeCanvas(ctx);
  const seen = [];
  t.onResult = (info) => seen.push(info);
  const lmNorm = canonicalLandmarks('B');

  t._handleResults({ landmarks: [lmNorm] }, ctx, overlay);
  t._handleResults({ landmarks: [lmNorm] }, ctx, overlay); // window [B,B]
  t._handleResults({ landmarks: [] }, ctx, overlay);       // hand gone

  assert.deepEqual(seen[2], { hand: false });
  assert.equal(ctx._count('clearRect'), 3);
  assert.equal(t.smoothed.buf.length, 0); // window was reset

  // a different letter right after is NOT diluted by the stale B window
  t._handleResults({ landmarks: [canonicalLandmarks('C')] }, ctx, overlay);
  assert.equal(seen[3].letter, 'C');
  assert.equal(seen[3].agreement, 1);
});

test('_handleResults works without an onResult listener', () => {
  const t = new HandTracker();
  t._handleResults({ landmarks: [canonicalLandmarks('A')] }, recordingCtx(), fakeCanvas(recordingCtx()));
  assert.equal(t.smoothed.buf.length, 1);
});

// ---- stop() teardown --------------------------------------------------------

test('stop halts the loop, releases the camera and closes the landmarker', async () => {
  const lm = fakeLandmarker(() => ({ landmarks: [] }));
  const t = new TestTracker(lm);
  const { raf, cam } = await startedTracker(t);
  const video = fakeVideo();
  video.srcObject = cam.stream;

  t.stop(video);

  assert.equal(t.running, false);
  assert.equal(cam.stopped, 1); // every track stopped
  assert.equal(video.srcObject, null);
  assert.equal(lm.closedCount, 1);
  assert.equal(t.landmarker, null);
  assert.equal(t.smoothed.buf.length, 0); // smoother reset for the next session
});

test('stop is safe to call twice and without a video element', async () => {
  const lm = fakeLandmarker(() => ({ landmarks: [] }));
  const t = new TestTracker(lm);
  await startedTracker(t);
  assert.doesNotThrow(() => t.stop());
  assert.doesNotThrow(() => t.stop(fakeVideo())); // second pass: nothing left to release
  assert.equal(t.running, false);
});
