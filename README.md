# SignQuest 🤟

Duolingo-style ASL alphabet trainer that watches your hands through the camera.

Fully client-side: MediaPipe HandLandmarker (tasks-vision) runs in your browser,
landmarks feed a dataset-grounded geometric classifier — no server, no accounts,
no data leaves the machine.

## Run

    python3 -m http.server 8700
    open http://127.0.0.1:8700

(Any static server works; a server is needed because the app uses ES modules.)

## Features

- All 26 ASL letters: 24 static poses in 9 lesson units + the movement letters
  J (pinky traces a J) and Z (index traces a Z), recognized by trajectory
  matching in js/motion.js
- Camera practice: hold the target sign ~1.2s to earn a star (3 stars per
  letter); movement letters score by tracing the dashed glyph path
- Live skeleton overlay + "seeing: X" feedback with per-frame shape-match score
- Reference sheet with skeleton renders for static letters and stroke glyphs
  (start dot + direction arrow) for J/Z
- Quiz mode over letters you've unlocked — wrong answers record the letter you
  actually showed
- XP + daily streak, persisted in localStorage

## Dataset grounding

The letter prototypes are no longer hand-authored. They are k-means centroids
(6 per letter, 24 static letters) over **3,120 real hand-landmark samples**
extracted with the same MediaPipe `hand_landmarker` (float16/1) model the app
runs, from the Hugging Face dataset
[Marxulia/asl_sign_languages_alphabets_v03](https://huggingface.co/datasets/Marxulia/asl_sign_languages_alphabets_v03).
Features are per-dim whitened (mean within-class std).

Measured on a held-out 20% of that data: **85.2%** top-1 accuracy vs **40.6%**
for the previous hand-authored canonical prototypes. Committed under
`tests/fixtures/` are 12 real samples per letter (26 letters) that pin the
classifier, its rotation/scale/jitter robustness, and its mirror-invariance
property (91% measured — MediaPipe's relative-depth channel doesn't mirror
consistently, so the floor is 87%).

Regenerate prototypes (needs a landmarks JSONL/JSON file, see script header):

    node scripts/build-prototypes.mjs <landmarks.jsonl|json> [out]

## Architecture

    js/geometry.js    — canonical skeletons + J/Z stroke glyphs (shared spec)
    js/classifier.js  — invariant features + nearest-prototype matching
                        (dataset-derived prototypes in js/prototypes.js)
    js/motion.js      — movement letters: fingertip trajectory classifier
    js/camera.js      — MediaPipe HandLandmarker wiring + smoothing; feeds the
                        classifier square-space landmarks (non-square feeds
                        used to stretch the geometry ~33% and skew matching)
    js/render.js      — skeleton drawing (live + target/reference) + stroke glyphs
    js/app.js         — lessons/reference/quiz UI, progress, practice loop
    tests/            — node:test suite (52 checks) incl. real-hand fixtures

Classification: scale/rotation/translation/handedness-invariant features
(finger chain curls, MCP flexion, palm-frame fingertip positions, pinch
distances), nearest-prototype in whitened weighted feature space. A 9-frame
majority-vote smoother with flicker grace absorbs detection dropouts. J/Z add
a path classifier: resampled fingertip trajectory, unit-normalized, matched by
mean segment-angle difference against mirrored glyph prototypes with ±30°
rotation tolerance, emitted after the hand goes quiet.

## Tests

    npm test    # node:test suites: classifier (real-hand fixtures +
                # perturbation + mirror + smoothing contracts), motion (J/Z
                # tracing), camera decision loop (lifecycle, fallback,
                # per-frame handling), quiz state machine, render fit logic.
                # The webcam itself is hardware — the logic around it is
                # what's under test.
