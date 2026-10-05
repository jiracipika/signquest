// Browser camera + MediaPipe HandLandmarker (tasks-vision) wiring.
// Loads lazily from CDN on first practice session; graceful error message if
// the CDN is unreachable. analyze loop: video frame -> landmarks -> classify.

import { classify, SmoothedClassifier, margin } from './classifier.js';
import { drawHandSkeleton } from './render.js';

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  constructor() {
    // n=9 vote window, grace=3: up to 3 consecutive no-hand frames (brief
    // detection dropouts) hold the accumulated vote instead of wiping it.
    this.smoothed = new SmoothedClassifier(9, 3);
    this.landmarker = null;
    this.running = false;
    this.onResult = null; // (info) => void
    this.onError = null;  // (msg) => void
    this._raf = null;
    this._lastTs = -1;
    this._fellBackToCpu = false; // detect-time GPU failure this session (reset by stop)
  }

  async start(videoEl, overlayCanvas) {
    if (this.running) return;
    // 1) + 2) Load tasks-vision and create the landmarker (downloads the model
    // on first use). GPU delegate is faster; fall back to CPU automatically
    // (older Macs, blocked WebGL, VMs).
    try {
      this.landmarker = await this._createLandmarker('GPU');
    } catch (e) {
      this.landmarker = await this._createLandmarker('CPU');
    }

    // 3) Camera.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();

    // 4) rAF detection loop (VIDEO mode requires monotonically increasing timestamps).
    this.running = true;
    const ctx = overlayCanvas.getContext('2d');
    const loop = () => {
      if (!this.running) return;
      if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        if (overlayCanvas.width !== videoEl.videoWidth) {
          overlayCanvas.width = videoEl.videoWidth;
          overlayCanvas.height = videoEl.videoHeight;
        }
        const now = performance.now();
        if (now <= this._lastTs) this._lastTs += 1;
        else this._lastTs = now;
        try {
          const res = this.landmarker.detectForVideo(videoEl, this._lastTs);
          this._handleResults(res, ctx, overlayCanvas);
        } catch (e) {
          // GPU delegate can fail at detect-time on some machines → once.
          if (!this._fellBackToCpu) {
            this._fellBackToCpu = true;
            // BUGFIX (2026-10-05): this used to just `return`, so after the
            // first detect-time failure the rAF loop was never scheduled again
            // and detection froze permanently — even though the CPU landmarker
            // finished building. Rebuild on CPU, then RESUME the loop unless
            // the tracker was stopped in the meantime.
            this._restartWithCpu().then(() => {
              if (this.running) this._raf = requestAnimationFrame(loop);
            });
            return;
          }
          if (this.onError) this.onError('detection error: ' + e.message);
        }
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  // Load the tasks-vision ESM bundle + build a HandLandmarker for `delegate`
  // ('GPU' or 'CPU'). Extracted so tests can stub model/wasm wiring.
  async _createLandmarker(delegate) {
    let vision;
    try {
      vision = await import(/* @vite-ignore */ `${VISION_URL}/vision_bundle.mjs`);
    } catch (e) {
      throw new Error('Could not load the hand-tracking library (check your internet connection).');
    }
    const fileset = await vision.FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
    return vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      numHands: 1,
      runningMode: 'VIDEO',
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  _restartWithCpu() {
    // Async swap: rebuild landmarker with CPU delegate, keep camera running.
    // Returns a promise that settles once the swap finished (failures surface
    // via onError + running=false, so the promise itself never rejects and the
    // loop-resume .then() in start() can simply check this.running).
    return (async () => {
      try {
        const vision = await import(/* @vite-ignore */ `${VISION_URL}/vision_bundle.mjs`);
        const fileset = await vision.FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
        if (this.landmarker) {
          try { this.landmarker.close(); } catch {}
        }
        this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          numHands: 1,
          runningMode: 'VIDEO',
        });
      } catch (e) {
        if (this.onError) this.onError('CPU fallback failed: ' + e.message);
        this.running = false;
      }
    })();
  }

  _handleResults(res, ctx, overlayCanvas) {
    const W = overlayCanvas.width, H = overlayCanvas.height;
    ctx.clearRect(0, 0, W, H);
    let info = { hand: false };
    const lms = res && res.landmarks;
    if (lms && lms.length > 0) {
      const lmNorm = lms[0];
      const lm = lmNorm.map((p) => ({ x: p.x * W, y: p.y * H, z: (p.z || 0) * W }));
      drawHandSkeleton(ctx, lm);
      const result = classify(lm);
      if (result) {
        const sm = this.smoothed.push(result);
        info = {
          hand: true,
          letter: sm.letter,
          agreement: sm.agreement,
          distance: result.distance,
          margin: margin(result),
        };
      }
    } else {
      // Flicker policy: a brief detection gap HOLDS the accumulated vote; only
      // a sustained absence (3 consecutive no-hand frames) resets, so
      // intermittent detection still builds a stable vote instead of starting
      // the window over on every dropout.
      this.smoothed.absent();
    }
    if (this.onResult) this.onResult(info);
  }

  stop(videoEl) {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (videoEl && videoEl.srcObject) {
      for (const t of videoEl.srcObject.getTracks()) t.stop();
      videoEl.srcObject = null;
    }
    if (this.landmarker) {
      try { this.landmarker.close(); } catch {}
      this.landmarker = null;
    }
    // BUGFIX (2026-10-05): _fellBackToCpu used to survive stop(), so one
    // transient GPU failure downgraded every future session until page reload.
    // The latch is per-session: the next start() must retry GPU.
    this._fellBackToCpu = false;
    this.smoothed.reset();
  }
}
