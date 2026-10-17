import type { Severity, StatusTag } from '@aerotrack/core';

// Times are shown in Sydney local time (the coverage area), labelled with the zone.
const TZ = 'Australia/Sydney';
const timeFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const timeSecFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const zoneFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, timeZoneName: 'short' });

export const fmtTime = (ts: number) => timeFmt.format(ts);
export const fmtTimeSec = (ts: number) => timeSecFmt.format(ts);
export const fmtDate = (ts: number | string) => dateFmt.format(new Date(ts));
export const zoneName = (ts: number) => zoneFmt.formatToParts(ts).find((p) => p.type === 'timeZoneName')?.value ?? '';

export const fmtFt = (ft: number | null | undefined) => (ft == null ? '—' : `${Math.round(ft).toLocaleString('en-AU')} ft`);
export const fmtKt = (kt: number | null | undefined) => (kt == null ? '—' : `${Math.round(kt)} kt`);
export const fmtDeg = (d: number | null | undefined) => (d == null ? '—' : `${Math.round(d).toString().padStart(3, '0')}°`);
export const fmtFpm = (r: number | null | undefined) =>
  r == null ? '—' : `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(Math.round(r / 10) * 10).toLocaleString('en-AU')} ft/min`;

export function fmtDuration(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  info: 'var(--sev-info)',
  notice: 'var(--sev-notice)',
  warning: 'var(--sev-warning)',
  alert: 'var(--sev-alert)',
};

export const STATUS_TONE: Record<StatusTag, 'green' | 'blue' | 'cyan' | 'violet' | 'grey' | 'teal'> = {
  Landed: 'green',
  Cruising: 'blue',
  Climbing: 'cyan',
  Descending: 'cyan',
  Approach: 'violet',
  'Taking off': 'teal',
  Taxiing: 'grey',
  'On ground': 'grey',
  Airborne: 'blue',
  Unknown: 'grey',
};

/** Hex colours for map features (MapLibre can't read CSS variables). */
export const MAP_COLOR = {
  aircraft: '#e2e8f0',
  selected: '#fbbf24',
  stale: '#64748b',
  info: '#94a3b8',
  notice: '#fbbf24',
  warning: '#fb923c',
  alert: '#f87171',
  track: '#38bdf8',
  gap: '#94a3b8',
  glitch: '#f87171',
  route: '#a78bfa',
};
