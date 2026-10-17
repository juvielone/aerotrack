import type { SessionDetail } from '@aerotrack/core';
import { fmtTime, MAP_COLOR } from '../format';

const W = 360;
const H = 120;
const PAD = { l: 34, r: 8, t: 8, b: 18 };
const BAND_TYPES = new Set(['holding', 'rapid-descent', 'go-around', 'go-around-hint', 'squawk-7700', 'squawk-7600']);

/** Altitude over time for the selected flight. Gaps break the line; rejected readings are marked, not plotted. */
export function AltitudeChart({ detail }: { detail: SessionDetail }) {
  const pts = detail.track;
  if (pts.length < 2) return null;
  const t0 = pts[0].ts;
  const t1 = pts[pts.length - 1].ts;
  const valid = pts.filter((p) => !p.glitch);
  const maxAlt = Math.max(1000, ...valid.map((p) => p.alt ?? 0));
  const yMax = Math.ceil(maxAlt / 5000) * 5000;
  const x = (ts: number) => PAD.l + ((ts - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (alt: number) => PAD.t + (1 - alt / yMax) * (H - PAD.t - PAD.b);
  const altOf = (p: (typeof pts)[number]) => (p.onGround ? 0 : (p.alt ?? 0));

  const paths = detail.segments.map(([a, b]) => {
    let d = '';
    for (let i = a; i <= b; i++) {
      const p = pts[i];
      if (p.glitch || (p.alt === null && !p.onGround)) continue;
      d += `${d ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(altOf(p)).toFixed(1)}`;
    }
    return d;
  });

  return (
    <figure className="alt-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Altitude over time">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(yMax * f)} y2={y(yMax * f)} className="grid" />
            <text x={PAD.l - 4} y={y(yMax * f) + 3} textAnchor="end" className="axis">
              {f === 0 ? '0' : `${((yMax * f) / 1000).toLocaleString('en-AU')}k`}
            </text>
          </g>
        ))}
        {detail.session.events
          .filter((e) => BAND_TYPES.has(e.type))
          .map((e) => (
            <rect
              key={e.id}
              x={x(Math.max(e.startTs, t0))}
              width={Math.max(2, x(Math.min(e.endTs, t1)) - x(Math.max(e.startTs, t0)))}
              y={PAD.t}
              height={H - PAD.t - PAD.b}
              fill={MAP_COLOR[e.severity]}
              opacity={0.16}
            >
              <title>{e.type}</title>
            </rect>
          ))}
        {detail.segments.slice(1).map(([a], n) => {
          const prev = pts[detail.segments[n][1]];
          const next = pts[a];
          return <line key={a} x1={x(prev.ts)} x2={x(next.ts)} y1={y(altOf(prev))} y2={y(altOf(next))} className="gap-line" />;
        })}
        {paths.map((d, i) => (
          <path key={i} d={d} className="alt-line" />
        ))}
        {pts
          .filter((p) => p.glitch && p.alt !== null)
          .map((p) => (
            <g key={p.ts} transform={`translate(${x(p.ts)},${y(Math.min(p.alt!, yMax))})`} className="glitch-mark">
              <path d="M-3,-3L3,3M3,-3L-3,3" />
              <title>Rejected reading: {p.alt} ft (ignored)</title>
            </g>
          ))}
        <text x={PAD.l} y={H - 4} className="axis">
          {fmtTime(t0)}
        </text>
        <text x={W - PAD.r} y={H - 4} textAnchor="end" className="axis">
          {fmtTime(t1)}
        </text>
      </svg>
      <figcaption>
        Altitude (ft). Dashed = no data{pts.some((p) => p.glitch) ? ' · ✕ = rejected reading' : ''}
      </figcaption>
    </figure>
  );
}
