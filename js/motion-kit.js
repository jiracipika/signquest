// Motion kit — DOM presentation-layer animations for SignQuest.
//
// Powered by the vendored Motion bundle (js/vendor/motion-kit.js, motion.dev).
// Strictly cosmetic: it animates transform/opacity of views that app.js has
// already rendered (hero, units, reference cards, quiz card) and adds spring
// hover/press feedback to buttons and cards. It never touches the camera
// pipeline, detection, quiz state, scoring, or any ids/classes/text — app.js
// is unaware this module exists.
//
// House rules:
// - Initial hidden states are set FROM JS, never in CSS: if this file fails
//   to load, the site renders exactly as before, fully visible.
// - prefers-reduced-motion: reduce disables everything (live via matchMedia).
// - Only transform/opacity are animated (compositor-friendly, no layout).

import { animate, inView, stagger } from './vendor/motion-kit.js';

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reduceQuery.matches;
if (reduceQuery.addEventListener) {
  reduceQuery.addEventListener('change', (e) => {
    reducedMotion = e.matches;
  });
}

// "Cool but subtle": soft spring, small travel.
const SPRING = { type: 'spring', bounce: 0.25, duration: 0.6 };
const ENTER_Y = 18;

// ---- entrances -------------------------------------------------------------

// Failsafe for the house rule "never leave content hidden": if an entrance
// never manages to run (frames stalled, throttled background tab, animation
// failure), snap the element visible. Healthy springs finish well inside the
// window, so this never races a working animation.
function armRescue(el) {
  setTimeout(() => {
    if (!el.isConnected) return;
    // Release any stalled animation hold (WAAPI or JS) before snapping.
    if (el.getAnimations) el.getAnimations().forEach((a) => a.cancel());
    if (getComputedStyle(el).opacity === '0') {
      el.style.opacity = '1';
      el.style.transform = 'none';
    }
  }, 5000);
}

function riseIn(els, { y = ENTER_Y, gap = 0.06, delay = 0 } = {}) {
  if (reducedMotion) return;
  const targets = [...els].filter(Boolean);
  if (!targets.length) return;
  targets.forEach(armRescue);
  animate(
    targets,
    { opacity: [0, 1], y: [y, 0] },
    { delay: stagger(gap, { startDelay: delay }), ...SPRING }
  );
}

// Scroll reveal: hide now (from JS), animate in the first time the element
// enters the viewport. Used per element; new renders get fresh elements.
function revealOnScroll(els, { y = ENTER_Y } = {}) {
  if (reducedMotion) return;
  for (const el of els) {
    el.style.opacity = '0';
    armRescue(el);
    inView(el, () => {
      animate(el, { opacity: [0, 1], y: [y, 0] }, SPRING);
    });
  }
}

// ---- per-render enhancement ------------------------------------------------

const view = document.getElementById('view');

function enhanceView() {
  if (!view) return;

  // Hero/header text: staggered spring entrance on every view render.
  const hero = view.querySelector('.hero');
  if (hero) riseIn(hero.children, { gap: 0.08 });

  // Lesson units: reveal each section as it scrolls into view.
  revealOnScroll(view.querySelectorAll('.unit'));

  // Reference grid: per-card reveals (scroll itself provides the stagger).
  revealOnScroll(view.querySelectorAll('.ref-card'));

  // Quiz card: a quick single-card entrance (it re-renders per question).
  const quizCard = view.querySelector('.quiz-card');
  if (quizCard) riseIn([quizCard], { y: 12 });
}

if (view) {
  // app.js re-renders the view with innerHTML on every navigation/answer.
  // Batch the mutation burst into one microtask (fires before paint, so
  // hidden states apply without a flash of unstyled content).
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhanceView();
    });
  }).observe(view, { childList: true, subtree: true });

  // The boot render happened before this module ran, so enhance it now.
  enhanceView();

  // Topbar (brand, nav, stats): one entrance stagger at boot only.
  const topbar = document.querySelector('.topbar');
  if (topbar) riseIn(topbar.children, { gap: 0.07 });
}

// ---- hover lift + press springs (event delegation; survives re-renders) ----

// Elements that get the Motion hover lift. Locked letter nodes are excluded
// (cursor: not-allowed; their CSS keeps them static).
const HOVERABLE = '.nav-btn, .quiz-btn, .letter-node:not(.locked), .ref-card';

// Motion now owns `transform` on this element: its spring writes style.transform
// every frame, which a CSS `transition: transform` would smear. Only
// .letter-node has one — restate its non-transform transition inline so the
// border-color hover highlight stays instant while Motion drives the lift.
function takeOverTransform(el) {
  if (el.dataset.motionFx) return;
  el.dataset.motionFx = '1';
  if (el.classList.contains('letter-node')) {
    el.style.transition = 'border-color 0.15s';
  }
}

function hoverIn(el) {
  if (reducedMotion) return;
  takeOverTransform(el);
  animate(el, { y: -3, scale: 1.02 }, { type: 'spring', bounce: 0.4, duration: 0.35 });
}

function hoverOut(el) {
  if (reducedMotion) return;
  takeOverTransform(el);
  animate(el, { y: 0, scale: 1 }, SPRING);
}

if (view) {
  // pointerenter/leave don't bubble; derive enter/leave from over/out pairs.
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return; // press springs cover touch feedback
    const el = e.target.closest?.(HOVERABLE);
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    hoverIn(el);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.(HOVERABLE);
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    hoverOut(el);
  });

  let pressedEl = null;
  document.addEventListener('pointerdown', (e) => {
    if (reducedMotion || e.button > 0) return;
    const el = e.target.closest?.(HOVERABLE);
    if (!el || el.disabled) return;
    pressedEl = el;
    takeOverTransform(el);
    animate(el, { scale: 0.96 }, { type: 'spring', bounce: 0.5, duration: 0.25 });
  });
  const release = () => {
    if (!pressedEl) return;
    animate(pressedEl, { scale: 1 }, SPRING);
    pressedEl = null;
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
}
