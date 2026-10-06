// Canvas rendering: hand skeleton overlays + idealized letter target skeletons.
// The target renderer is the "teach" visual — user mimics the drawn shape.
import { canonicalLandmarks, MOTION_STROKES } from './geometry.js';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],           // index
  [5, 9], [9, 10], [10, 11], [11, 12],      // middle
  [9, 13], [13, 14], [14, 15], [15, 16],    // ring
  [13, 17], [17, 18], [18, 19], [19, 20],   // pinky
  [0, 17],                                   // palm base
];

export function drawHandSkeleton(ctx, lm, { color = '#7c5cff', ok = false } = {}) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = ok ? '#2ecc71' : color;
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    ctx.moveTo(lm[a].x, lm[a].y);
    ctx.lineTo(lm[b].x, lm[b].y);
  }
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Draw the idealized letter skeleton into a canvas (used for targets/reference).
// Movement letters (J/Z) have no skeleton — their glyph IS the stroke, so we
// draw the traced path with a direction arrowhead instead.
export function renderLetterTarget(canvas, letter, { color = '#9d85ff' } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, 0, W, H);

  const stroke = MOTION_STROKES[letter];
  if (stroke) {
    const pad = 28;
    const scale = Math.min((W - pad * 2), (H - pad * 2));
    const offX = (W - scale) / 2, offY = (H - scale) / 2;
    const pts = stroke.map(([x, y]) => [x * scale + offX, y * scale + offY]);
    ctx.lineWidth = 9;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    // start dot + direction arrowhead on the final segment
    ctx.fillStyle = '#2ecc71';
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], 6, 0, Math.PI * 2);
    ctx.fill();
    const [ax, ay] = pts[pts.length - 2];
    const [bx, by] = pts[pts.length - 1];
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - 12 * Math.cos(ang - 0.45), by - 12 * Math.sin(ang - 0.45));
    ctx.lineTo(bx - 12 * Math.cos(ang + 0.45), by - 12 * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
    return;
  }

  // Fit: geometry y is up; canvas y is down. Normalize by bounds.
  const lm = canonicalLandmarks(letter);
  if (!lm) return;

  // Fit: geometry y is up; canvas y is down. Normalize by bounds.
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of lm) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const spanX = Math.max(maxX - minX, 0.4);
  const spanY = Math.max(maxY - minY, 0.4);
  const scale = Math.min((W - 36) / spanX, (H - 36) / spanY);
  const offX = (W - spanX * scale) / 2 - minX * scale;
  const pts = lm.map((p) => ({
    x: p.x * scale + offX,
    y: H - (p.y * scale + (H - spanY * scale) / 2 - minY * scale) , // flip y
  }));

  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
  }
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
