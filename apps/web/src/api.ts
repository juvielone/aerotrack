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

/** A Planespotters.net photo of an aircraft, with what is needed to credit it. */
export interface AircraftPhoto {
  src: string;
  width: number;
  height: number;
  link: string;
  photographer: string;
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
  speed?: number;
  /** Demo example: the pattern this snippet shows (an InsightType). */
  expectedInsight?: string;
  /** Demo example: aircraft to select and the moment the pattern first shows. */
  focus?: { hex: string; ts: number };
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
