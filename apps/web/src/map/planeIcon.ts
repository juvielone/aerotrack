/** Draws a top-down airliner silhouette (nose up) for use as an SDF icon tinted per aircraft state. */
export function planeImage(size = 64): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const s = size / 32;
  ctx.scale(s, s);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  // Fuselage
  ctx.moveTo(16, 2);
  ctx.bezierCurveTo(17.3, 2, 17.8, 3.6, 17.8, 5.5);
  ctx.lineTo(17.8, 12);
  // Right wing
  ctx.lineTo(29, 18.5);
  ctx.lineTo(29, 20.6);
  ctx.lineTo(17.8, 17.4);
  ctx.lineTo(17.8, 24.2);
  // Right tailplane
  ctx.lineTo(21.5, 27);
  ctx.lineTo(21.5, 28.8);
  ctx.lineTo(16, 27.4);
  // Left tailplane
  ctx.lineTo(10.5, 28.8);
  ctx.lineTo(10.5, 27);
  ctx.lineTo(14.2, 24.2);
  ctx.lineTo(14.2, 17.4);
  // Left wing
  ctx.lineTo(3, 20.6);
  ctx.lineTo(3, 18.5);
  ctx.lineTo(14.2, 12);
  ctx.lineTo(14.2, 5.5);
  ctx.bezierCurveTo(14.2, 3.6, 14.7, 2, 16, 2);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
