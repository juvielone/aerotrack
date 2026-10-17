import type { Airport, SessionDetail, Snapshot } from '@aerotrack/core';

export type Mode = 'live' | 'recorded';

export interface AppConfig {
  center: [number, number];
  radiusNm: number;
  live: { enabled: boolean; source: string; pollSeconds: number };
  airports: Airport[];
  lowCoverage: [number, number][][];
  speeds: number[];
}

export interface Highlight {
  label: string;
  ts: number;
  hex?: string;
}

export interface RecordingInfo {
  id: string;
  title: string;
  date: string;
  source: string;
  kind: 'live-capture' | 'imported-trace' | 'synthetic';
  center?: [number, number];
  zoom?: number;
  description?: string;
  reportedCause?: string;
  sourceLink?: string;
  highlights?: Highlight[];
  startTs: number;
  endTs: number;
  polls: number;
}

export interface ReplayState {
  replayId: string;
  recordingId: string;
  t: number;
  startTs: number;
  endTs: number;
  speed: number;
  playing: boolean;
  ended: boolean;
}

export type StreamSnapshot = Snapshot & { replay?: ReplayState };

export async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export function sessionUrl(mode: Mode, replayId: string | undefined, sessionId: string): string | null {
  const id = encodeURIComponent(sessionId);
  if (mode === 'live') return `/api/live/session/${id}`;
  return replayId ? `/api/replay/${replayId}/session/${id}` : null;
}

export type { SessionDetail };
