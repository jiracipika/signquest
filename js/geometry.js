// Shared hand math + canonical (idealized) ASL letter skeletons.
// The canonical generator is used by:
//   - the app (teaching overlay: "make your hand look like this")
//   - the reference screen (renders each letter's target shape)
//   - the classifier tests (deterministic fixtures for all 24 static letters)
//
// Coordinate system: y is UP (like math, unlike video). x+ points toward the
// pinky side of the RIGHT hand as seen un-mirrored. analyzeHand() normalizes
// video landmarks into this space (y flip + handedness flip).

const deg = (r) => r;
const dir = (a) => [Math.sin(a), Math.cos(a)]; // angle measured from +y, rotating toward +x
const add = (p, v) => [p[0] + v[0], p[1] + v[1]];
const mul = (v, s) => [v[0] * s, v[1] * s];
const P = (p) => ({ x: p[0], y: p[1], z: 0 });

// Finger chain definitions. Landmark indices follow MediaPipe Hands (21 pts).
// Fingers: mcp -> pip -> dip -> tip ; thumb: cmc -> mcp -> ip -> tip
const FINGER_MCP = {
  index: [-0.34, 0.82],
  middle: [-0.11, 0.9],
  ring: [0.12, 0.86],
  pinky: [0.34, 0.74],
};
const FINGER_BASE_ANGLE = { index: -0.15, middle: 0.0, ring: 0.15, pinky: 0.32 };
const FINGER_SEGS = [0.32, 0.22, 0.18];
const FINGER_START_IDX = { index: 5, middle: 9, ring: 13, pinky: 17 };
const THUMB_START = [-0.22, 0.12];
const THUMB_SEGS = [0.28, 0.26, 0.22];

// Pose spec per letter:
//   fingers: { index|middle|ring|pinky: { angle?: overrideBaseAngle, curls: [mcp,pip,dip] } }
//   thumb:   { angle: baseAngle, curls: [a,b,c] }
// curls are radians of flexion added at each joint (positive = curl toward palm).
export const LETTER_POSES = {
  A: {
    fingers: fistFingers(),
    thumb: { angle: -0.1, curls: [0, 0, 0] },
  }, // fist, thumb up along the side
  B: {
    fingers: flatFingers(),
    thumb: { angle: 0.35, curls: [0.75, 0.95, 0.55] },
  }, // fingers up, thumb across palm
  C: {
    fingers: curveFingers([0.7, 0.5, 0.35]),
    thumb: { angle: -0.5, curls: [0.5, 0.4, 0.2] },
  }, // curved hand, open gap
  D: {
    fingers: {
      index: { curls: [0, 0, 0] },
      middle: fist(),
      ring: fist(),
      pinky: fist(),
    },
    thumb: { angle: -0.35, curls: [0.85, 0.75, 0.45] },
  }, // index up, thumb touches middle tip
  E: {
    fingers: curveFingers([1.0, 0.9, 0.7]),
    thumb: { angle: 0.3, curls: [0.7, 0.7, 0.4] },
  }, // fingers curled tight, thumb low across them
  F: {
    fingers: {
      index: { curls: [1.5, 1.25, 0.7] },
      middle: flat(),
      ring: flat(),
      pinky: flat(),
    },
    thumb: { angle: -0.35, curls: [0.6, 0.5, 0.2] },
  }, // thumb+index pinch, three fingers up
  G: {
    fingers: { index: { angle: 1.57, curls: [0, 0, 0] }, middle: fist(), ring: fist(), pinky: fist() },
    thumb: { angle: 1.3, curls: [0, 0, 0] },
  }, // index points sideways, thumb parallel below
  H: {
    fingers: {
      index: { angle: 1.57, curls: [0, 0, 0] },
      middle: { angle: 1.57, curls: [0, 0, 0] },
      ring: fist(),
      pinky: fist(),
    },
    thumb: { angle: 0.35, curls: [0.75, 0.95, 0.55] },
  }, // index+middle together pointing sideways
  I: {
    fingers: { index: fist(), middle: fist(), ring: fist(), pinky: flat() },
    thumb: { angle: 0.35, curls: [0.75, 0.95, 0.55] },
  }, // pinky up only
  K: {
    fingers: {
      index: { curls: [0, 0, 0] },
      middle: { angle: 0.28, curls: [0, 0, 0] },
      ring: fist(),
      pinky: fist(),
    },
    thumb: { angle: -0.55, curls: [0, 0, 0] },
  }, // index+middle up spread, thumb between them
  L: {
    fingers: { index: flat(), middle: fist(), ring: fist(), pinky: fist() },
    thumb: { angle: -1.35, curls: [0, 0, 0] },
  }, // L shape: index up, thumb out
  M: {
    fingers: fistFingers(),
    thumb: { angle: 0.45, curls: [0.55, 0.75, 0.35] },
  }, // thumb tucked under three fingers
  N: {
    fingers: fistFingers(),
    thumb: { angle: 0.3, curls: [0.5, 0.65, 0.3] },
  }, // thumb tucked under two fingers
  O: {
    fingers: curveFingers([1.3, 0.9, 0.6]),
    thumb: { angle: -0.45, curls: [0.2, 0.9, 1.1] },
  }, // all fingertips meet thumb in a ring
  P: {
    fingers: {
      index: { angle: 3.0, curls: [0, 0, 0] },
      middle: { angle: 3.28, curls: [0, 0, 0] },
      ring: fist(),
      pinky: fist(),
    },
    thumb: { angle: 2.6, curls: [0, 0, 0] },
  }, // K rotated to point down
  Q: {
    fingers: { index: { angle: 2.2, curls: [0, 0, 0] }, middle: fist(), ring: fist(), pinky: fist() },
    thumb: { angle: 2.6, curls: [0, 0, 0] },
  }, // G rotated to point down
  R: {
    fingers: {
      index: { angle: 0.25, curls: [0, 0, 0] },
      middle: { angle: -0.25, curls: [0, 0, 0] },
      ring: fist(),
      pinky: fist(),
    },
    thumb: { angle: 0.35, curls: [0.75, 0.95, 0.55] },
  }, // index+middle up, crossed
  S: {
    fingers: fistFingers(),
    thumb: { angle: 0.05, curls: [0.7, 0.9, 0.5] },
  }, // fist, thumb in front across fingers
  T: {
    fingers: fistFingers(),
    thumb: { angle: 0.25, curls: [0.45, 0.55, 0.25] },
  }, // thumb between index and middle
  U: {
    fingers: {
      index: { angle: -0.06, curls: [0, 0, 0] },
      middle: { angle: 0.06, curls: [0, 0, 0] },
      ring: fist(),
      pinky: fist(),
    },
    thumb: { angle: 0.35, curls: [0.75, 0.95, 0.55] },
  }, // index+middle up together
  V: {
    fingers: {
      index: { angle: -0.35, curls: [0, 0, 0] },
      middle: { angle: 0.35, curls: [0, 0, 0] },
      ring: fist(),
      pinky: fist(),
    },
    thumb: { angle: 0.35, curls: [0.75, 0.95, 0.55] },
  }, // index+middle up spread
  W: {
    fingers: {
      index: { angle: -0.3, curls: [0, 0, 0] },
      middle: { curls: [0, 0, 0] },
      ring: { angle: 0.3, curls: [0, 0, 0] },
      pinky: fist(),
    },
    thumb: { angle: 0.35, curls: [0.75, 0.95, 0.55] },
  }, // three fingers up
  X: {
    fingers: {
      index: { curls: [1.0, 0.8, -0.2] },
      middle: fist(),
      ring: fist(),
      pinky: fist(),
    },
    thumb: { angle: 0.35, curls: [0.75, 0.95, 0.55] },
  }, // index hooked, rest closed
  Y: {
    fingers: { index: fist(), middle: fist(), ring: fist(), pinky: flat() },
    thumb: { angle: -1.3, curls: [0, 0, 0] },
  }, // thumb+pinky out
};

function fist() {
  return { curls: [1.9, 1.8, 1.5] };
}
function flat() {
  return { curls: [0, 0, 0] };
}
function fistFingers() {
  return { index: fist(), middle: fist(), ring: fist(), pinky: fist() };
}
function flatFingers() {
  return { index: flat(), middle: flat(), ring: flat(), pinky: flat() };
}
function curveFingers(c) {
  return {
    index: { curls: c },
    middle: { curls: c },
    ring: { curls: c },
    pinky: { curls: c },
  };
}

// Build 21 MediaPipe-style landmarks for a letter. Returns null for unknown.
export function canonicalLandmarks(letter) {
  const cfg = LETTER_POSES[letter];
  if (!cfg) return null;
  const lm = new Array(21).fill(null);
  lm[0] = P([0, 0]); // wrist
  for (const f of Object.keys(FINGER_MCP)) {
    const spec = cfg.fingers[f];
    let ang = spec.angle !== undefined ? spec.angle : FINGER_BASE_ANGLE[f];
    let p = FINGER_MCP[f];
    const base = FINGER_START_IDX[f];
    lm[base] = P(p);
    for (let s = 0; s < 3; s++) {
      ang += spec.curls[s];
      p = add(p, mul(dir(ang), FINGER_SEGS[s]));
      lm[base + 1 + s] = P(p);
    }
  }
  let ang = cfg.thumb.angle;
  let p = THUMB_START;
  lm[1] = P(p);
  for (let s = 0; s < 3; s++) {
    ang += cfg.thumb.curls[s];
    p = add(p, mul(dir(ang), THUMB_SEGS[s]));
    lm[2 + s] = P(p);
  }
  return lm;
}

export const STATIC_LETTERS = Object.keys(LETTER_POSES).sort();
