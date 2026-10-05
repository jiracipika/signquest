# SignQuest 🤟

Duolingo-style ASL alphabet trainer that watches your hands through the camera.

Fully client-side: MediaPipe HandLandmarker (tasks-vision) runs in your browser,
landmarks feed a deterministic geometric classifier — no server, no accounts,
no data leaves the machine.

## Run

    python3 -m http.server 8700
    open http://127.0.0.1:8700

(Any static server works; a server is needed because the app uses ES modules.)

## Features

- 24 static ASL letters (A-Y minus J/Z, which require motion) in 8 lesson units
- Camera practice: hold the target sign ~1.2s to earn a star (3 stars per letter)
- Live skeleton overlay + "seeing: X" feedback with per-frame shape-match score
- Reference sheet with idealized skeleton renders for every letter
- Timed quiz mode over letters you've unlocked
- XP + daily streak, persisted in localStorage

## Architecture

    js/geometry.js    — canonical idealized 21-point skeleton per letter
    js/classifier.js  — invariant features + nearest-prototype matching
    js/camera.js      — MediaPipe HandLandmarker wiring + smoothing
    js/render.js      — skeleton drawing (live + target/reference)
    js/app.js         — lessons/reference/quiz UI, progress, practice loop
    tests/            — node:test suite for geometry + classifier

The classifier needs no training data: each letter has a canonical skeleton
(generated from per-letter pose specs), features are scale/rotation/translation/
handedness invariant, and classification is nearest-prototype in weighted
feature space. A 9-frame majority-vote smoother absorbs flicker.

## Tests

    npm test    # node:test suites: classifier (canonical + perturbation +
                # mirror + smoothing contracts), camera decision loop
                # (lifecycle, fallback, per-frame handling), quiz state
                # machine, render fit logic. The webcam itself is hardware —
                # the logic around it is what's under test.
