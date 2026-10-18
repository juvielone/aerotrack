// Adapted from teamate-src/detector/analyseFlight.ts
import { config } from '../config';
import { explainSignal, LAST_SEEN_ON_GROUND, minutesAgo } from '../explain';
import type { EventEvidence, EventType, FlightEvent, GapCause, SignalState } from '../types';
import type { FlightInsight, InsightEvidence, InsightType } from './types';

export interface AnalyseInput {
  /** Detector output for one flight session (events never carry across sessions). */
  events: FlightEvent[];
  /** Live signal state of the session at `nowMs`. */
  signal?: SignalState;
}

const fmtFt = (ft: number | null | undefined) => (ft == null ? '?' : `${Math.round(ft).toLocaleString('en-AU')} ft`);
const fmtRate = (fpm: number) => `${(Math.round(Math.abs(fpm) / 100) * 100).toLocaleString('en-AU')} ft/min`;
const fmtDur = (ms: number) => minutesAgo(ms / 1000);

const TYPE: Record<EventType, InsightType | null> = {
  climb: 'CLIMB',
  descent: 'DESCENT',
  turn: 'TURN',
  holding: 'POSSIBLE_CIRCLING',
  'rapid-descent': 'RAPID_DESCENT',
  'go-around': 'GO_AROUND',
  'go-around-hint': 'POSSIBLE_GO_AROUND',
  'squawk-7700': 'SQUAWK_7700',
  'squawk-7600': 'SQUAWK_7600',
  glitch: 'DATA_GLITCH',
  gap: 'TRACKING_RESUMED',
};

/** Shown as "Recent" after they happen; never active in real time. */
const MOMENTARY = new Set<EventType>(['go-around', 'glitch']);

/**
 * Turns one session's detector events and signal state into Insights-panel entries at `nowMs`.
 * Pure: `nowMs` is the snapshot time (wall clock live, replay clock recorded); nothing reads the system clock.
 * Returns only insights that are active or recent at `nowMs`, highest priority first.
 */
export function analyseFlight(input: AnalyseInput, nowMs: number): FlightInsight[] {
  const c = config.insight;
  const stale = input.signal?.stale ?? false;
  const out: FlightInsight[] = [];

  for (const e of input.events) {
    const type = TYPE[e.type];
    if (!type) continue;
    const since = nowMs - e.endTs;
    let status: FlightInsight['status'] | null = null;
    if (e.type === 'gap') {
      // Ground gaps are expected (patchy ground coverage) and not worth a message.
      if (e.evidence.startAlt != null && since <= c.resumedSec * 1000) status = 'recent';
    } else if (MOMENTARY.has(e.type)) {
      if (since <= c.recentSec * 1000) status = 'recent';
    } else {
      const clearedMs = (c.minClearedSec[e.type as keyof typeof c.minClearedSec] ?? 0) * 1000;
      // A session that has gone quiet has no ongoing pattern, only its last-seen time.
      if ((e.ongoing && !stale) || since <= clearedMs) status = 'active';
      else if (e.type === 'rapid-descent' && since <= c.recentSec * 1000) status = 'recent';
    }
    if (status) out.push(fromEvent(e, type, status));
  }

  const lost = fromSignal(input.signal, nowMs);
  if (lost) out.push(lost);
  return out.sort(byPriority);
}

export function priorityOf(type: InsightType): number {
  const i = (config.insight.priority as readonly string[]).indexOf(type);
  return i < 0 ? Infinity : i;
}

const byPriority = (a: FlightInsight, b: FlightInsight) => priorityOf(a.type) - priorityOf(b.type) || b.lastSeenAt - a.lastSeenAt;

function evidenceOf(ev: EventEvidence): InsightEvidence {
  const out: InsightEvidence = { windowStart: ev.startTs, windowEnd: ev.endTs };
  // Missing values are left out, never guessed.
  if (ev.startAlt != null) out.startValue = ev.startAlt;
  if (ev.endAlt != null) out.endValue = ev.endAlt;
  if (ev.rateFpm !== undefined) out.rate = ev.rateFpm;
  if (ev.degrees !== undefined) out.degrees = ev.degrees;
  if (ev.obsCount !== undefined) out.sampleCount = ev.obsCount;
  return out;
}

function fromEvent(e: FlightEvent, type: InsightType, status: FlightInsight['status']): FlightInsight {
  const ev = e.evidence;
  const dur = fmtDur(ev.endTs - ev.startTs);
  const base = { id: e.id, type, status, detectedAt: e.startTs, lastSeenAt: e.endTs, evidence: evidenceOf(ev), eventId: e.id };
  switch (e.type) {
    case 'climb':
      return {
        ...base,
        title: 'Climbing',
        observed: `Climbed from ${fmtFt(ev.startAlt)} to ${fmtFt(ev.endAlt)} over ${dur}.`,
        explanation: 'This often happens after take-off or when changing cruising level.',
        limitations: "The data doesn't confirm why.",
      };
    case 'descent':
      return {
        ...base,
        title: 'Descending',
        observed: `Descended from ${fmtFt(ev.startAlt)} to ${fmtFt(ev.endAlt)} over ${dur}.`,
        explanation: 'This often happens on approach.',
        limitations: "The data doesn't confirm why.",
      };
    case 'turn':
      return {
        ...base,
        title: 'Changing direction',
        observed: `Turned about ${ev.degrees}° to the ${ev.direction} over ${dur}.`,
        explanation: 'The aircraft is changing direction, possibly as part of its route.',
      };
    case 'holding': {
      const low = (ev.startAlt ?? 0) < 2000;
      return {
        ...base,
        confidence: ev.confidence ?? 'medium',
        title: 'Possible circling',
        observed: `Turned about ${ev.degrees}° over ${dur} and came back near an earlier position.`,
        explanation: low
          ? 'Appears to be circling at low altitude.'
          : 'Appears to be circling. Aircraft often do this in a holding pattern while waiting to land.',
        limitations: "Aerotrack can't confirm a holding pattern or say why the aircraft is circling from tracking data alone.",
      };
    }
    case 'rapid-descent':
      return {
        ...base,
        title: 'Rapid descent',
        observed: `Descending at about ${fmtRate(ev.rateFpm ?? 0)}, from ${fmtFt(ev.startAlt)} to ${fmtFt(ev.endAlt)} over ${dur}.`,
        explanation: 'Descending unusually quickly. This can happen for several reasons.',
        limitations: "Aerotrack can't tell the cause of the descent from tracking data alone.",
      };
    case 'go-around':
      return {
        ...base,
        confidence: 'high',
        title: 'Go-around',
        observed: `Descended to ${fmtFt(ev.lowestAlt)} near ${ev.airport ?? 'an airport'}, climbed away, then landed on a later approach.`,
        explanation: 'This is called a go-around and is a routine procedure.',
        limitations: "Tracking data can't show why the first landing attempt was discontinued.",
      };
    case 'go-around-hint':
      return {
        ...base,
        confidence: 'low',
        title: 'Possible go-around',
        observed: `Climbing after descending to ${fmtFt(ev.lowestAlt)} near ${ev.airport ?? 'an airport'}.`,
        explanation: 'This may be a go-around.',
        limitations: 'It can only be confirmed once the aircraft lands.',
      };
    case 'squawk-7700':
      return {
        ...base,
        confidence: 'high',
        title: 'Emergency code 7700',
        observed: 'This aircraft is transmitting a general emergency code (7700).',
        explanation: '7700 is the transponder code for a general emergency.',
        limitations: "Aerotrack can't tell the nature or severity of the situation from the code alone.",
      };
    case 'squawk-7600':
      return {
        ...base,
        confidence: 'high',
        title: 'Radio failure code 7600',
        observed: 'This aircraft is transmitting code 7600, which signals a loss of radio communication.',
        explanation: '7600 is the transponder code for a radio communication failure.',
        limitations: "Aerotrack can't tell the cause or the impact from the code alone.",
      };
    case 'glitch':
      return {
        ...base,
        title: 'Bad altitude reading ignored',
        observed: `One altitude reading (${fmtFt(ev.rejectedAlt)}) was inconsistent and has been ignored.`,
        explanation: 'A single reading that jumps and immediately returns is almost always a data error.',
        limitations: 'The ignored reading is not used for any other insight.',
      };
    case 'gap':
      return {
        ...base,
        title: 'Position updates resumed',
        observed: `Position updates resumed after a ${dur} gap.`,
        explanation: gapWording(ev.gapCause),
        limitations: 'The line on the map shows a gap, not the actual path.',
      };
  }
}

function gapWording(cause: GapCause | undefined): string {
  if (cause === 'feed') return 'Our live feed was unavailable at the time. This was a problem on our side, not with the aircraft.';
  if (cause === 'coverage') return 'This area often has poor receiver coverage. This is normal.';
  return "The cause isn't known from the data. This usually doesn't mean anything happened to the aircraft.";
}

const SIGNAL_TITLE: Record<GapCause, string> = {
  feed: 'Live data unavailable',
  coverage: 'Positions stopped arriving',
  unexpected: 'Positions stopped arriving',
};

const SIGNAL_LIMITS: Record<GapCause, string> = {
  feed: 'No aircraft positions can be shown until our feed recovers.',
  coverage: 'Aerotrack only knows where receivers usually lose coverage, not why this aircraft did.',
  unexpected: "The cause of the interruption can't be determined from the gap alone.",
};

function fromSignal(signal: SignalState | undefined, nowMs: number): FlightInsight | null {
  if (!signal?.stale || !Number.isFinite(signal.secondsSinceLast)) return null;
  const lastTs = nowMs - signal.secondsSinceLast * 1000;
  const base = {
    id: 'signal',
    type: 'TRACKING_INTERRUPTED' as const,
    status: 'active' as const,
    detectedAt: lastTs,
    lastSeenAt: nowMs,
    evidence: { windowStart: lastTs, windowEnd: nowMs },
  };
  const observed = `No new position for ${minutesAgo(signal.secondsSinceLast)}.`;
  if (!signal.cause) return { ...base, title: 'Last seen on the ground', observed, explanation: LAST_SEEN_ON_GROUND };
  return {
    ...base,
    title: SIGNAL_TITLE[signal.cause],
    observed,
    explanation: signal.text ?? explainSignal(signal.cause, signal.secondsSinceLast),
    limitations: SIGNAL_LIMITS[signal.cause],
  };
}
