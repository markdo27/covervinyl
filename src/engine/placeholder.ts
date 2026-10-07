/** Stand-in artwork so the preview shows the full effect before anything is uploaded. */

const PALETTES = [
  ['#c2412d', '#f2b34a'],
  ['#1f3d5a', '#8fb8c9'],
  ['#2d2a26', '#d9c9a8'],
  ['#5b2a6e', '#e58fb1'],
  ['#204a2f', '#c8d96f'],
  ['#7a1f1f', '#f0e0c0'],
  ['#14213d', '#fca311'],
  ['#3d405b', '#f2cc8f'],
];

const coverCache = new Map<number, HTMLCanvasElement>();

export function placeholderCover(index: number): HTMLCanvasElement {
  const cached = coverCache.get(index);
  if (cached) return cached;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const [a, b] = PALETTES[index % PALETTES.length];

  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // A record peeking out, to make it read as "album cover".
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(size * 0.62, size * 0.56, size * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = b;
  ctx.beginPath();
  ctx.arc(size * 0.62, size * 0.56, size * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `800 ${size * 0.2}px "Inter Variable", system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(String(index + 1).padStart(2, '0'), size * 0.07, size * 0.06);
  ctx.font = `600 ${size * 0.055}px "Inter Variable", system-ui, sans-serif`;
  ctx.fillText('ALBUM COVER', size * 0.075, size * 0.87);

  coverCache.set(index, canvas);
  return canvas;
}

/** Called after fonts load so the placeholder lettering is redrawn with Inter. */
export function clearPlaceholderCache(): void {
  coverCache.clear();
}

/** Moody turntable stand-in background with a spinning red record. */
export function drawPlaceholderBackground(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const bg = ctx.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, H * 0.9);
  bg.addColorStop(0, '#3a2418');
  bg.addColorStop(0.45, '#120c0a');
  bg.addColorStop(1, '#050404');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const cx = W * 0.32;
  const cy = H * 0.8;
  const R = W * 0.78;
  const angle = t * Math.PI * 2 * (33.333 / 60);

  // Vinyl
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#0b0b0c';
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, W * 0.0015);
  for (let r = R * 0.42; r < R * 0.98; r += R * 0.018) {
    ctx.strokeStyle = `rgba(255,255,255,${0.025 + 0.02 * Math.sin(r * 0.37)})`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Label
  ctx.rotate(angle);
  const L = R * 0.38;
  const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, L);
  lg.addColorStop(0, '#d0261d');
  lg.addColorStop(1, '#9c140f');
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.arc(0, 0, L, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,180,0.55)';
  ctx.lineCap = 'round';
  ctx.lineWidth = L * 0.07;
  for (const [ox, oy] of [
    [-0.45, -0.35],
    [0.45, -0.3],
  ]) {
    ctx.beginPath();
    ctx.moveTo(L * (ox - 0.14), L * (oy - 0.14));
    ctx.lineTo(L * (ox + 0.14), L * (oy + 0.14));
    ctx.moveTo(L * (ox + 0.14), L * (oy - 0.14));
    ctx.lineTo(L * (ox - 0.14), L * (oy + 0.14));
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,225,190,0.6)';
  ctx.font = `700 ${L * 0.16}px "Inter Variable", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('SIDE A', 0, L * 0.55);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(0, 0, L * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Warm lamp light and vignette
  const glow = ctx.createRadialGradient(W * 0.9, H * 0.02, 0, W * 0.9, H * 0.02, W * 0.9);
  glow.addColorStop(0, 'rgba(255,170,90,0.35)');
  glow.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}
