import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FlightPoint, RawPoll } from '@aerotrack/core';
import { env } from './env';
import { slimAircraft } from './providers';

export interface Highlight {
  label: string;
  /** Recording time to jump to (ms since epoch). */
  ts: number;
  /** Aircraft to select (hex). */
  hex?: string;
}

export interface RecordingMeta {
  id: string;
  title: string;
  file: string;
  /** ISO date the data was captured / flown. */
  date: string;
  /** Attribution, e.g. "ADSB.lol (ODbL)". */
  source: string;
  kind: 'live-capture' | 'imported-trace' | 'synthetic';
  center?: [number, number];
  zoom?: number;
  /** Stale threshold override for sparse imported traces. */
  staleSec?: number;
  description?: string;
  /** "Later reported as…" — shown separately from what the data shows, always with a source. */
  reportedCause?: string;
  sourceLink?: string;
  highlights?: Highlight[];
  /** Default replay speed for this recording. */
  speed?: number;
  /** Demo example: the pattern this snippet shows (an InsightType). */
  expectedInsight?: string;
  /** Demo example: the aircraft to select, and the replay time when the pattern first shows (replay pauses there once). */
  focus?: { hex: string; ts: number };
}

export interface RecordingInfo extends RecordingMeta {
  startTs: number;
  endTs: number;
  polls: number;
}

const recDir = () => join(env.dataDir, 'recordings');
/** Committed demo snippets in the recorded-flight template format (FlightPoint[]). */
const templateDir = () => join(env.dataDir, 'recorded');
const cache = new Map<string, { mtime: number; polls: RawPoll[] }>();

export function listRecordings(): RecordingInfo[] {
  const manifestPath = join(recDir(), 'manifest.json');
  const manifest: RecordingMeta[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
  // A snippet whose NDJSON isn't on this machine (fresh clone) still replays from its committed template.
  const available = manifest.filter((m) => existsSync(join(recDir(), m.file)));
  const ids = new Set(available.map((m) => m.id));
  const templates = templateMetas().filter((m) => !ids.has(m.id));
  return [...available, ...templates]
    .map((m) => {
      const polls = loadPolls(m);
      return { ...m, startTs: polls[0]?.now ?? 0, endTs: polls[polls.length - 1]?.now ?? 0, polls: polls.length };
    })
    .filter((r) => r.polls > 0);
}

/**
 * What the Recorded tab lists: only the curated demo examples (entries with `expectedInsight`), unless
 * AEROTRACK_SHOW_CAPTURES=true, which adds every other recording after them. With no examples, everything is listed.
 */
export function demoRecordings(): RecordingInfo[] {
  const all = listRecordings();
  const examples = all.filter((r) => r.expectedInsight);
  if (!examples.length) return all;
  return env.showCaptures ? [...examples, ...all.filter((r) => !r.expectedInsight)] : examples;
}

export function getRecording(id: string): { info: RecordingInfo; polls: RawPoll[] } | null {
  const info = listRecordings().find((r) => r.id === id);
  if (!info) return null;
  return { info, polls: loadPolls(info) };
}

/** data/recorded/*.json files that contain points, as recording entries. */
function templateMetas(): RecordingMeta[] {
  if (!existsSync(templateDir())) return [];
  const out: RecordingMeta[] = [];
  for (const f of readdirSync(templateDir()).filter((x) => x.endsWith('.json'))) {
    try {
      const t = JSON.parse(readFileSync(join(templateDir(), f), 'utf8'));
      if (!t.points?.length) continue; // empty templates are placeholders, not data
      const lats = t.points.map((p: FlightPoint) => p.lat);
      const lons = t.points.map((p: FlightPoint) => p.lon);
      out.push({
        id: t.id,
        title: t.title,
        file: `template:${f}`,
        date: t.recording?.date ?? new Date(t.points[0].timestamp).toISOString(),
        source: 'ADSB.lol (ODbL)',
        kind: 'imported-trace',
        center: [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2],
        zoom: 8,
        staleSec: 120,
        ...(t.expectedInsight?.type && { expectedInsight: t.expectedInsight.type }),
        ...(t.focus && { focus: t.focus }),
        ...(t.reportedCause && { reportedCause: t.reportedCause }),
        ...(t.recording?.newsSourceUrl && { sourceLink: t.recording.newsSourceUrl }),
      });
    } catch {
      // Not a recorded-flight file.
    }
  }
  return out;
}

/** FlightPoint[] template → one poll per point (position time). */
function templatePolls(file: string): RawPoll[] {
  const t = JSON.parse(readFileSync(join(templateDir(), file), 'utf8'));
  const hex = t.flight?.hex ?? t.focus?.hex ?? t.id;
  const callsign = t.flight?.callsign && t.flight.callsign !== 'UNKNOWN' ? t.flight.callsign : undefined;
  return (t.points as FlightPoint[]).map((p) => ({
    now: p.timestamp,
    ac: [
      slimAircraft({
        hex,
        flight: callsign,
        t: t.flight?.aircraftType !== 'UNKNOWN' ? t.flight?.aircraftType : undefined,
        lat: p.lat,
        lon: p.lon,
        alt_baro: p.onGround ? 'ground' : (p.altitudeFt ?? undefined),
        gs: p.groundSpeedKt ?? undefined,
        track: p.headingDeg ?? undefined,
        baro_rate: p.verticalRateFpm ?? undefined,
        squawk: p.squawk ?? undefined,
        emergency: p.emergency ?? undefined,
        seen_pos: 0,
      }),
    ],
  }));
}

function loadPolls(m: RecordingMeta): RawPoll[] {
  if (m.file.startsWith('template:')) return templatePolls(m.file.slice('template:'.length));
  const path = join(recDir(), m.file);
  const mtime = statSync(path).mtimeMs;
  const hit = cache.get(m.id);
  if (hit && hit.mtime === mtime) return hit.polls;
  const polls: RawPoll[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line) as RawPoll;
      polls.push(p.error ? { now: p.now, error: p.error } : { now: p.now, ac: (p.ac ?? []).map(slimAircraft) });
    } catch {
      // A partially written last line while recording is in progress.
    }
  }
  polls.sort((a, b) => a.now - b.now);
  cache.set(m.id, { mtime, polls });
  return polls;
}
