import type { FlightEvent, GapCause, Observation } from '../types';

/** An event before it gets an id and wording. */
export type Detected = Omit<FlightEvent, 'id' | 'text'>;

export interface DetectContext {
  mode: 'live' | 'recorded';
  staleSec: number;
  /** Was our own feed down at any point during [from, to]? */
  feedDownDuring(from: number, to: number): boolean;
  isLowCoverage(lat: number, lon: number): boolean;
}

export function gapCause(ctx: DetectContext, lat: number, lon: number, from: number, to: number): GapCause {
  if (ctx.feedDownDuring(from, to)) return 'feed';
  if (ctx.isLowCoverage(lat, lon)) return 'coverage';
  return 'unexpected';
}

/** Airborne observations with a usable altitude (glitches excluded), with their original index. */
export function airborne(obs: Observation[]): { o: Observation; i: number }[] {
  const out: { o: Observation; i: number }[] = [];
  obs.forEach((o, i) => {
    if (!o.onGround && o.alt !== null && !o.glitch) out.push({ o, i });
  });
  return out;
}

export const sec = (ms: number) => Math.round(ms / 1000);
