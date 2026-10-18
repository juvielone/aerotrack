import type { IconClass } from '@aerotrack/core';

// Top-down silhouettes (nose up) on a 32×32 grid, drawn white as SDF icons and tinted per aircraft state.
// Our own simple shapes: one per aircraft family.

type Pt = [number, number];
type Shape =
  /** Right half of a symmetric outline, from the nose to the tail on the centre line (x = 16); mirrored. */
  | { half: Pt[] }
  /** A closed polygon, also drawn mirrored (x → 32 − x) unless `single`. */
  | { poly: Pt[]; single?: boolean }
  | { ellipse: [cx: number, cy: number, rx: number, ry: number] };

const rect = (x1: number, y1: number, x2: number, y2: number): Pt[] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
/** A thin bar between two points (rotor blades). */
function bar(a: Pt, b: Pt, w: number): Pt[] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dy);
  const [nx, ny] = [(-dy / len) * (w / 2), (dx / len) * (w / 2)];
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
}

export const ICON_SHAPES: Record<IconClass, Shape[]> = {
  narrow: [
    { half: [[16, 2], [17.3, 2.4], [17.8, 4.5], [17.8, 12], [29, 18.5], [29, 20.6], [17.8, 17.4], [17.8, 24.2], [21.5, 27], [21.5, 28.8], [16, 27.4]] },
    { poly: rect(21.4, 12.2, 23, 16.2) },
  ],
  wide: [
    { half: [[16, 1], [17.6, 1.5], [18.3, 3.8], [18.3, 11.5], [31, 18.6], [31, 20.8], [18.3, 17], [18.3, 25.2], [22.8, 28.4], [22.8, 30.4], [16, 29]] },
    { poly: rect(22, 10.6, 24.4, 15.6) },
  ],
  heavy4: [
    { half: [[16, 0.8], [17.9, 1.3], [18.6, 3.8], [18.6, 11.2], [31.2, 19.2], [31.2, 21.4], [18.6, 17.2], [18.6, 25.6], [23.4, 28.8], [23.4, 30.8], [16, 29.4]] },
    { poly: rect(20.8, 9.8, 22.8, 14.4) },
    { poly: rect(25.4, 12.8, 27.4, 17.4) },
  ],
  turboprop: [
    { half: [[16, 3], [17, 3.5], [17.5, 5.2], [17.5, 11], [29.5, 11.6], [29.5, 14.2], [17.5, 14.6], [17.2, 25.2], [21.2, 26.6], [21.2, 28.4], [16, 28]] },
    { poly: rect(20.6, 8.6, 22.4, 14.4) },
    { poly: rect(19, 8, 24, 8.8) },
  ],
  bizjet: [
    { half: [[16, 5], [16.9, 5.6], [17.2, 7.5], [17.2, 14.5], [25.5, 19.8], [25.5, 21.3], [17.2, 18.6], [17.2, 26.2], [20.8, 27.6], [20.8, 28.9], [16, 28.3]] },
    { poly: rect(17.2, 21, 19.4, 24.4) },
  ],
  light: [
    { half: [[16, 6.6], [16.9, 7], [17.2, 8.6], [17.2, 10.8], [28.5, 10.8], [28.5, 13.6], [17.2, 13.6], [16.8, 23], [20.2, 23.6], [20.2, 25.4], [16, 25.2]] },
    { poly: rect(12.6, 5.9, 19.4, 6.6), single: true },
  ],
  helicopter: [
    { ellipse: [16, 13, 3.2, 5] },
    { poly: rect(15.4, 16.5, 16.6, 28), single: true },
    { poly: rect(13.6, 26.4, 18.4, 27.6), single: true },
    { poly: bar([6, 3], [26, 23], 1.4), single: true },
    { poly: bar([26, 3], [6, 23], 1.4), single: true },
  ],
  glider: [
    { half: [[16, 6], [16.7, 6.6], [16.8, 9], [16.8, 13.4], [31.6, 14.2], [31.6, 15.4], [16.8, 15.6], [16.5, 26], [19.8, 26.6], [19.8, 27.7], [16, 27.6]] },
  ],
  fighter: [
    { half: [[16, 1.5], [16.8, 3.5], [17.3, 9], [17.7, 13.5], [27.5, 22.6], [27.5, 24.4], [18.2, 24.4], [18.2, 26.4], [21, 28.2], [21, 29.8], [16, 29.2]] },
  ],
};

const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [32 - x, y]);

/** Closed polygons (and ellipses) to fill for one icon, in grid units. */
export function iconPolygons(cls: IconClass): { polys: Pt[][]; ellipses: [number, number, number, number][] } {
  const polys: Pt[][] = [];
  const ellipses: [number, number, number, number][] = [];
  for (const s of ICON_SHAPES[cls]) {
    if ('half' in s) polys.push([...s.half, ...mirror(s.half).slice(1, -1).reverse()]);
    else if ('poly' in s) {
      polys.push(s.poly);
      if (!s.single) polys.push(mirror(s.poly));
    } else ellipses.push(s.ellipse);
  }
  return { polys, ellipses };
}

/** Draws one family's silhouette (nose up) for use as an SDF icon tinted per aircraft state. */
export function iconImage(cls: IconClass, size = 64): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.scale(size / 32, size / 32);
  ctx.fillStyle = '#fff';
  const { polys, ellipses } = iconPolygons(cls);
  for (const p of polys) {
    ctx.beginPath();
    p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  for (const [cx, cy, rx, ry] of ellipses) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return ctx.getImageData(0, 0, size, size);
}
