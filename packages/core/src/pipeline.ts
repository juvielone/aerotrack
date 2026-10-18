import { segmentTrack } from './clean';
import { config } from './config';
import { CoverageModel } from './coverage';
import { detectEvents, type DetectContext } from './detectors';
import { analyseFlight } from './insights/analyseFlight';
import { explainSignal, LAST_SEEN_ON_GROUND } from './explain';
import { normalizePoll } from './normalize';
import { SessionStore } from './sessions';
import { computeStatus } from './status';
import type { AircraftSummary, EventType, FeedState, FlightSession, RawPoll, SessionDetail, SignalState, Snapshot } from './types';

export interface PipelineOptions {
  mode: 'live' | 'recorded';
  coverage?: CoverageModel;
  /** Override the stale threshold (e.g. for sparse imported traces). */
  staleSec?: number;
}

/** How notable each event type is, for the notable-flights list (higher = more severe). */
const NOTABLE_RANK: Partial<Record<EventType | 'signal-lost', number>> = {
  'squawk-7700': 6,
  'squawk-7600': 5,
  'rapid-descent': 4,
  'go-around': 3,
  'go-around-hint': 3,
  'signal-lost': 2,
  holding: 1,
};
const NOTABLE_LINGER_MS = config.notable.lingerSec * 1000;
const SHOW_STALE_MS = config.stale.showStaleSec * 1000;

/**
 * Feed → flight sessions → detectors → snapshot. Used identically for live polling and recorded replay,
 * so a recording always produces exactly what live mode would have shown.
 */
export class Pipeline {
  readonly store: SessionStore;
  readonly coverage: CoverageModel;
  readonly staleSec: number;
  private feed: FeedState = { ok: true, lastOkTs: null, error: null, down: false };
  private outages: [number, number | null][] = [];
  private lastNow = 0;

  constructor(readonly opts: PipelineOptions) {
    this.store = new SessionStore({ historyWindowSec: opts.mode === 'live' ? config.session.historyWindowSec : null });
    this.coverage = opts.coverage ?? new CoverageModel(null);
    this.staleSec = opts.staleSec ?? config.stale.staleSec;
  }

  private ctx: DetectContext = {
    mode: 'live',
    staleSec: config.stale.staleSec,
    feedDownDuring: (from, to) => this.outages.some(([a, b]) => a <= to && (b === null || b >= from)),
    isLowCoverage: (lat, lon) => this.coverage.isLowCoverage(lat, lon),
  };

  ingest(poll: RawPoll): void {
    this.lastNow = poll.now;
    if (poll.error) {
      this.feed.ok = false;
      this.feed.error = poll.error;
      const open = this.outages[this.outages.length - 1];
      if (!open || open[1] !== null) this.outages.push([this.feed.lastOkTs ?? poll.now, null]);
      return;
    }
    const open = this.outages[this.outages.length - 1];
    if (open && open[1] === null) open[1] = poll.now;
    this.feed.ok = true;
    this.feed.error = null;
    this.feed.lastOkTs = poll.now;

    const changed = this.store.ingest(normalizePoll(poll));
    const ctx = { ...this.ctx, mode: this.opts.mode, staleSec: this.staleSec };
    for (const id of changed) {
      const s = this.store.get(id);
      if (s) s.events = detectEvents(s.obs, ctx);
    }
    this.store.prune(poll.now);
    if (this.outages.length > 50) this.outages.splice(0, this.outages.length - 50);
  }

  feedState(now: number = this.lastNow): FeedState {
    const sinceOk = this.feed.lastOkTs === null ? Infinity : now - this.feed.lastOkTs;
    let down = !this.feed.ok && sinceOk > config.stale.feedDownSec * 1000;
    if (!down && this.feed.ok) {
      // "All aircraft went stale at once" also means our feed, not the aircraft.
      const recent = this.store.current().filter((s) => now - s.lastTs < SHOW_STALE_MS && !s.obs[s.obs.length - 1]?.onGround);
      const stale = recent.filter((s) => now - s.lastTs > this.staleSec * 1000);
      down = recent.length >= config.stale.feedMinAircraft && stale.length / recent.length >= config.stale.feedStaleShare;
    }
    return { ...this.feed, down };
  }

  signal(s: FlightSession, now: number, feedDown: boolean): SignalState {
    const last = s.obs[s.obs.length - 1];
    const secondsSinceLast = last ? Math.max(0, (now - last.ts) / 1000) : Infinity;
    const stale = secondsSinceLast > this.staleSec;
    if (!stale || !last) return { stale, secondsSinceLast };
    if (last.onGround) return { stale, secondsSinceLast, text: LAST_SEEN_ON_GROUND };
    const cause = feedDown ? 'feed' : this.coverage.isLowCoverage(last.lat, last.lon) ? 'coverage' : 'unexpected';
    return { stale, secondsSinceLast, cause, text: explainSignal(cause, secondsSinceLast) };
  }

  snapshot(now: number = this.lastNow): Snapshot {
    const feed = this.feedState(now);
    const aircraft: AircraftSummary[] = [];
    for (const s of this.store.current()) {
      const last = s.obs[s.obs.length - 1];
      if (!last || now - last.ts > SHOW_STALE_MS) continue;
      const signal = this.signal(s, now, feed.down);
      const notable: AircraftSummary['notable'] = [];
      let severityRank = 0;
      for (const e of s.events) {
        const rank = NOTABLE_RANK[e.type];
        if (!rank || (!e.ongoing && now - e.endTs > NOTABLE_LINGER_MS)) continue;
        notable.push({ id: e.id, type: e.type, severity: e.severity, text: e.text });
        severityRank = Math.max(severityRank, rank);
      }
      if (signal.stale && signal.cause === 'unexpected') severityRank = Math.max(severityRank, NOTABLE_RANK['signal-lost']!);
      const meta = latestMeta(s);
      aircraft.push({
        sessionId: s.id,
        hex: s.hex,
        callsign: s.callsign,
        reg: meta.reg,
        type: meta.type,
        category: meta.category,
        dbFlags: meta.dbFlags,
        lat: last.lat,
        lon: last.lon,
        alt: last.alt,
        onGround: last.onGround,
        gs: last.gs,
        track: last.track,
        baroRate: last.baroRate,
        squawk: last.squawk,
        lastTs: last.ts,
        status: computeStatus(s, now, this.staleSec),
        signal,
        notable,
        severityRank,
      });
    }
    return { now, feed, aircraft };
  }

  detail(sessionId: string, now: number = this.lastNow): SessionDetail | null {
    const s = this.store.get(sessionId);
    if (!s) return null;
    const feed = this.feedState(now);
    const { obs, ...rest } = s;
    const meta = latestMeta(s);
    const span = obs.length ? obs[obs.length - 1].ts - obs[0].ts : 0;
    const signal = this.signal(s, now, feed.down);
    return {
      session: { ...rest, reg: meta.reg, type: meta.type, category: meta.category },
      track: obs.map((o) => ({ ts: o.ts, lat: o.lat, lon: o.lon, alt: o.alt, onGround: o.onGround, gs: o.gs, glitch: o.glitch })),
      segments: segmentTrack(obs, this.staleSec),
      status: computeStatus(s, now, this.staleSec),
      signal,
      insufficientHistory: obs.length < config.status.minObs || span < 30_000,
      insights: analyseFlight({ events: s.events, signal }, now),
    };
  }
}

function latestMeta(s: FlightSession) {
  let reg: string | null = null;
  let type: string | null = null;
  let category: string | null = null;
  let dbFlags = 0;
  for (let i = s.obs.length - 1; i >= 0 && (!reg || !type || !category); i--) {
    const o = s.obs[i];
    reg ??= o.reg;
    type ??= o.type;
    category ??= o.category;
    dbFlags ||= o.dbFlags;
  }
  return { reg, type, category, dbFlags };
}
