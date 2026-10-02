/*
 * Progress as colour. A card fills with its book's colour in patches: round blots that appear at
 * different moments and grow until they merge. Blot positions come from the book's id, so each
 * book has its own stable pattern. For any progress, the blots are scaled so the coloured share
 * of the card matches the share of the book read.
 */

export interface Blot {
  x: number; // 0..1 across the card
  y: number; // 0..1 down the card
  m: number; // relative size
  t: number; // progress at which it appears
}

const COUNT = 7;

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Blots spread over a jittered 3 × 3 grid so they never all bunch in one corner. */
export function blotsFor(id: string): Blot[] {
  const r = rng(id);
  const cells = Array.from({ length: 9 }, (_, i) => i).sort(() => r() - 0.5).slice(0, COUNT);
  return cells.map((cell, k) => ({
    x: ((cell % 3) + 0.5 + (r() - 0.5) * 0.7) / 3,
    y: (Math.floor(cell / 3) + 0.5 + (r() - 0.5) * 0.7) / 3,
    m: 0.75 + r() * 0.5,
    t: k === 0 ? 0 : (k / COUNT) * 0.72 + (r() - 0.5) * 0.06,
  }));
}

const GRID_X = 26;
const GRID_Y = 18;

function coverage(blots: Blot[], radii: number[], w: number, h: number): number {
  let hit = 0;
  for (let gy = 0; gy < GRID_Y; gy++) {
    const py = ((gy + 0.5) / GRID_Y) * h;
    for (let gx = 0; gx < GRID_X; gx++) {
      const px = ((gx + 0.5) / GRID_X) * w;
      for (let i = 0; i < blots.length; i++) {
        const dx = px - blots[i].x * w;
        const dy = py - blots[i].y * h;
        if (radii[i] > 0 && dx * dx + dy * dy <= radii[i] * radii[i]) { hit++; break; }
      }
    }
  }
  return hit / (GRID_X * GRID_Y);
}

/** Pixel radii for each blot so that the covered share of a w × h card is about `p`. */
export function radiiFor(blots: Blot[], p: number, w: number, h: number): number[] {
  if (p <= 0 || !w || !h) return blots.map(() => 0);
  const growth = blots.map((b) => (p > b.t ? Math.pow((p - b.t) / (1 - b.t), 0.85) : 0));
  const diag = Math.hypot(w, h);
  let lo = 0;
  let hi = diag * 1.6;
  for (let i = 0; i < 16; i++) {
    const s = (lo + hi) / 2;
    const c = coverage(blots, growth.map((g, k) => g * blots[k].m * s), w, h);
    if (c < p) lo = s; else hi = s;
  }
  return growth.map((g, k) => g * blots[k].m * hi);
}

/** A CSS mask: one hard-edged circle per blot, unioned. */
export function maskFor(blots: Blot[], radii: number[], scale = 1): string {
  const layers = blots
    .map((b, i) => {
      const r = radii[i] * scale;
      if (r < 0.5) return null;
      return `radial-gradient(circle ${r.toFixed(1)}px at ${(b.x * 100).toFixed(2)}% ${(b.y * 100).toFixed(2)}%, #000 ${(r - 0.8).toFixed(1)}px, transparent ${r.toFixed(1)}px)`;
    })
    .filter(Boolean);
  return layers.length ? layers.join(', ') : 'linear-gradient(transparent, transparent)';
}
