import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RawPoll } from '@aerotrack/core';
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
}

export interface RecordingInfo extends RecordingMeta {
  startTs: number;
  endTs: number;
  polls: number;
}

const recDir = () => join(env.dataDir, 'recordings');
const cache = new Map<string, { mtime: number; polls: RawPoll[] }>();

export function listRecordings(): RecordingInfo[] {
  const manifestPath = join(recDir(), 'manifest.json');
  if (!existsSync(manifestPath)) return [];
  const manifest: RecordingMeta[] = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return manifest
    .filter((m) => existsSync(join(recDir(), m.file)))
    .map((m) => {
      const polls = loadPolls(m);
      return { ...m, startTs: polls[0]?.now ?? 0, endTs: polls[polls.length - 1]?.now ?? 0, polls: polls.length };
    })
    .filter((r) => r.polls > 0);
}

export function getRecording(id: string): { info: RecordingInfo; polls: RawPoll[] } | null {
  const info = listRecordings().find((r) => r.id === id);
  if (!info) return null;
  return { info, polls: loadPolls(info) };
}

function loadPolls(m: RecordingMeta): RawPoll[] {
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
