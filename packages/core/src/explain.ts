import type { EventType, GapCause } from './types';
import type { Detected } from './detectors/common';

// Fact-first wording (PRD §4). Never states a cause; "possible" where the data can't confirm.

const fmtFt = (ft: number | null | undefined) => (ft == null ? '?' : `${Math.round(ft).toLocaleString('en-AU')} ft`);
const fmtRate = (fpm: number) => `~${(Math.round(Math.abs(fpm) / 100) * 100).toLocaleString('en-AU')} ft/min`;

export function minutesAgo(sec: number): string {
  if (sec < 90) return `${Math.max(1, Math.round(sec))} s`;
  return `${Math.round(sec / 60)} min`;
}

export const EVENT_LABEL: Record<EventType, string> = {
  climb: 'Climbing',
  descent: 'Descending',
  turn: 'Changing direction',
  holding: 'Possible holding / circling',
  'rapid-descent': 'Rapid descent',
  'go-around': 'Go-around',
  'go-around-hint': 'Possible go-around',
  'squawk-7700': 'Emergency code 7700',
  'squawk-7600': 'Radio failure code 7600',
  glitch: 'Bad altitude reading ignored',
  gap: 'Gap in track',
};

export function explainEvent(e: Detected): string {
  const ev = e.evidence;
  switch (e.type) {
    case 'climb':
      return `The aircraft is climbing (${fmtFt(ev.startAlt)} → ${fmtFt(ev.endAlt)}). This often happens after take-off or when changing cruising level, but the data doesn't confirm why.`;
    case 'descent':
      return `The aircraft is descending (${fmtFt(ev.startAlt)} → ${fmtFt(ev.endAlt)}). This often happens on approach, but the data doesn't confirm why.`;
    case 'turn':
      return `The aircraft is changing direction (about ${ev.degrees}° ${ev.direction}), possibly as part of its route.`;
    case 'holding':
      // Low-level circling (helicopters, survey, training) isn't usually a hold, so don't suggest one.
      if ((ev.startAlt ?? 0) < 2000) return 'Appears to be circling at low altitude. The data alone can\'t show why.';
      return 'Appears to be circling. Aircraft often do this in a holding pattern while waiting to land, but the data alone can\'t confirm it.';
    case 'rapid-descent':
      return `Descending unusually quickly (${fmtRate(ev.rateFpm ?? 0)}). This can happen for several reasons, and the data doesn't show which.`;
    case 'go-around':
      return 'The aircraft descended towards the runway, then climbed away and landed on a later approach. This is called a go-around and is a routine procedure.';
    case 'go-around-hint':
      return 'Climbing after approach — possible go-around. This can only be confirmed once the aircraft lands.';
    case 'squawk-7700':
      return 'This aircraft is transmitting a general emergency code (7700).';
    case 'squawk-7600':
      return 'This aircraft is transmitting code 7600, which signals a loss of radio communication.';
    case 'glitch':
      return 'One altitude reading was inconsistent and has been ignored.';
    case 'gap':
      return `No data between these points (${minutesAgo(ev.durationSec ?? 0)}). The line shows a gap, not the actual path.${
        ev.gapCause === 'feed' ? ' Our live feed was unavailable at the time.' : ev.gapCause === 'coverage' ? ' This area often has poor receiver coverage.' : ''
      }`;
  }
}

/** Wording for an aircraft whose positions have stopped arriving (PRD §4.3). */
export function explainSignal(cause: GapCause, secondsSinceLast: number): string {
  switch (cause) {
    case 'feed':
      return 'Live data is temporarily unavailable. This is a problem on our side, not with any aircraft.';
    case 'coverage':
      return 'This aircraft is over an area where receivers often lose coverage (e.g. over the ocean). This is normal.';
    case 'unexpected':
      return `We stopped receiving positions from this aircraft ${minutesAgo(secondsSinceLast)} ago. The cause isn't known from the data. This usually doesn't mean anything happened to the aircraft.`;
  }
}

export const INSUFFICIENT_HISTORY = 'Not enough data yet to describe what this aircraft is doing.';
export const LAST_SEEN_ON_GROUND = 'Last seen on the ground. Aircraft often stop transmitting once parked, and ground coverage can be patchy.';
