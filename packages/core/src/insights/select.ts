import { config } from '../config';
import { minutesAgo } from '../explain';
import type { FlightInsight, InsightEvidence } from './types';

export interface InsightSelection {
  primary: FlightInsight;
  /** Other insights shown at the same time ("+N more" in the panel). */
  moreCount: number;
}

/**
 * Picks what the Insights panel shows at `nowMs`, or null for its default content.
 * `insights` come from analyseFlight (already active/recent and in priority order). Active detector insights
 * must have lasted `minActiveSec` before they show, so one noisy reading doesn't flash a message; tracking
 * interruptions are exempt because staleness already requires a minute without data.
 */
export function selectInsight(insights: FlightInsight[], nowMs: number): InsightSelection | null {
  const minMs = config.insight.minActiveSec * 1000;
  const shown = insights.filter(
    (i) => i.status === 'recent' || i.type === 'TRACKING_INTERRUPTED' || Math.min(i.lastSeenAt, nowMs) - i.detectedAt >= minMs,
  );
  if (!shown.length) return null;
  return { primary: shown[0], moreCount: shown.length - 1 };
}

/** Compact evidence, e.g. "−6,200 ft/min over 40 s, 5 readings". */
export function evidenceLine(ev: InsightEvidence): string {
  const n = (v: number) => Math.round(v).toLocaleString('en-AU');
  let value = '';
  if (ev.rate !== undefined) value = `${ev.rate < 0 ? '−' : '+'}${n(Math.abs(Math.round(ev.rate / 100) * 100))} ft/min`;
  else if (ev.degrees !== undefined) value = `${ev.degrees}°`;
  else if (ev.startValue !== undefined && ev.endValue !== undefined && ev.startValue !== ev.endValue) value = `${n(ev.startValue)} → ${n(ev.endValue)} ft`;
  const durSec = (ev.windowEnd - ev.windowStart) / 1000;
  const dur = durSec > 0 ? minutesAgo(durSec) : '';
  const readings = ev.sampleCount !== undefined ? `${ev.sampleCount} reading${ev.sampleCount === 1 ? '' : 's'}` : '';
  return [value && dur ? `${value} over ${dur}` : value || dur, readings].filter(Boolean).join(', ');
}
