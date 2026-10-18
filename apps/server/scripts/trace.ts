// Shared readsb / ADSB.lol globe_history trace parsing for the import and pattern-finding scripts.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { RawAircraft, RawPoll } from '@aerotrack/core';

export interface TracePoint {
  /** Position time, ms since epoch. */
  ts: number;
  ac: RawAircraft;
}

/** Reads a trace_full_<hex>.json (gzipped or plain) from a local path or URL. */
export async function readTrace(src: string): Promise<any> {
  let buf: Buffer;
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } else buf = readFileSync(src);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return JSON.parse(buf.toString('utf8'));
}

// readsb trace point: [secondsAfterTimestamp, lat, lon, alt|"ground"|null, gs, track, flags, vertRate, details|null, ...]
export function tracePoints(t: any): TracePoint[] {
  const hex = String(t.icao).toLowerCase();
  const state: Partial<RawAircraft> = { r: t.r, t: t.t, dbFlags: t.dbFlags };
  const out: TracePoint[] = [];
  for (const p of t.trace as any[]) {
    const [dt, lat, lon, alt, gs, track, , vrate, details] = p;
    if (details) {
      if (details.flight) state.flight = details.flight;
      if (details.squawk) state.squawk = details.squawk;
      if (details.emergency) state.emergency = details.emergency;
      if (details.category) state.category = details.category;
    }
    out.push({
      ts: Math.round((t.timestamp + dt) * 1000),
      ac: {
        ...state,
        hex,
        lat,
        lon,
        alt_baro: alt === 'ground' ? 'ground' : (alt ?? undefined),
        gs: gs ?? undefined,
        track: track ?? undefined,
        baro_rate: vrate ?? undefined,
        seen_pos: 0,
      } as RawAircraft,
    });
  }
  return out;
}

/** One poll per distinct position time. */
export function toPolls(points: TracePoint[]): RawPoll[] {
  const polls: RawPoll[] = [];
  for (const p of [...points].sort((a, b) => a.ts - b.ts)) {
    const last = polls[polls.length - 1];
    if (last && last.now === p.ts) last.ac!.push(p.ac);
    else polls.push({ now: p.ts, ac: [p.ac] });
  }
  return polls;
}

/** "2025-06-25T20:15" / "20:15" (on `date`) / ms → ms since epoch, all UTC. */
export function parseUtc(v: string, date?: string): number {
  if (/^\d+$/.test(v)) return Number(v);
  const iso = /^\d{1,2}:\d{2}(:\d{2})?$/.test(v) && date ? `${date}T${v.padStart(5, '0')}` : v;
  const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(ms)) throw new Error(`Can't read time "${v}" (use HH:MM UTC with --date, or an ISO time)`);
  return ms;
}
