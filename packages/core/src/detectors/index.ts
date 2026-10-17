import { markGlitches, verticalRates } from '../clean';
import { config } from '../config';
import { explainEvent } from '../explain';
import type { FlightEvent, Observation } from '../types';
import type { DetectContext, Detected } from './common';
import { glitchEvents, gapEvents } from './data';
import { detectGoArounds } from './goAround';
import { detectSquawks } from './squawk';
import { detectHolding, detectTurns } from './turns';
import { detectClimbDescent, detectRapidDescent } from './vertical';

export type { DetectContext } from './common';

/**
 * Runs every detector over a session's observations. Deterministic: the same observations always give
 * the same events with the same ids, so re-running after each poll updates events in place instead of re-alerting.
 */
export function detectEvents(obs: Observation[], ctx: DetectContext): FlightEvent[] {
  const flagged = markGlitches(obs);
  const rates = verticalRates(obs);
  const holding = detectHolding(obs, ctx.staleSec);
  const rapid = detectRapidDescent(obs, rates);
  const showHint = ctx.mode === 'live' && config.goAround.showUnconfirmedHint;
  const detected: Detected[] = [
    ...detectSquawks(obs),
    ...rapid,
    ...detectGoArounds(obs, rates, ctx.staleSec, showHint),
    ...holding,
    // A rapid descent is also a descent; report it once.
    ...detectClimbDescent(obs, rates).filter((d) => !(d.type === 'descent' && rapid.some((r) => r.startTs <= d.endTs && r.endTs >= d.startTs))),
    ...detectTurns(obs, ctx.staleSec, holding),
    ...glitchEvents(obs, flagged),
    ...gapEvents(obs, ctx),
  ];
  return detected
    .map((d) => ({ ...d, id: `${d.type}-${d.startTs}`, text: explainEvent(d) }))
    .sort((a, b) => a.startTs - b.startTs);
}
