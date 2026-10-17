import { config } from './config';
import type { FlightSession, Observation } from './types';

interface StoreOptions {
  /** Keep only this much history per session (live). null keeps everything (recorded replay). */
  historyWindowSec?: number | null;
}

interface SessionInternal extends FlightSession {
  /** Start of the current run of ground observations. */
  groundSince: number | null;
  landedTs: number | null;
}

/**
 * Groups observations into flight sessions (PRD §3.1). ICAO hex identifies the aircraft,
 * not the flight, so history and events are keyed by hex + callsign + start time.
 */
export class SessionStore {
  private sessions = new Map<string, SessionInternal>();
  private currentByHex = new Map<string, string>();
  private historyWindowMs: number | null;

  constructor(opts: StoreOptions = {}) {
    const w = opts.historyWindowSec === undefined ? config.session.historyWindowSec : opts.historyWindowSec;
    this.historyWindowMs = w === null ? null : w * 1000;
  }

  /** Adds observations; returns ids of sessions that received new data. */
  ingest(observations: Observation[]): Set<string> {
    const changed = new Set<string>();
    const sorted = [...observations].sort((a, b) => a.ts - b.ts);
    for (const o of sorted) {
      const id = this.add(o);
      if (id) changed.add(id);
    }
    return changed;
  }

  get(id: string): FlightSession | undefined {
    return this.sessions.get(id);
  }

  /** The latest session per aircraft. */
  current(): FlightSession[] {
    const out: FlightSession[] = [];
    for (const id of this.currentByHex.values()) {
      const s = this.sessions.get(id);
      if (s) out.push(s);
    }
    return out;
  }

  all(): FlightSession[] {
    return [...this.sessions.values()];
  }

  /** Drops old history (live) and sessions not seen for a long time. */
  prune(now: number): void {
    const dropBefore = now - config.session.dropAfterSec * 1000;
    for (const [id, s] of this.sessions) {
      if (s.lastTs < dropBefore) {
        this.sessions.delete(id);
        if (this.currentByHex.get(s.hex) === id) this.currentByHex.delete(s.hex);
        continue;
      }
      if (this.historyWindowMs !== null) {
        const keepFrom = now - this.historyWindowMs;
        if (s.obs.length && s.obs[0].ts < keepFrom) {
          s.obs = s.obs.filter((o) => o.ts >= keepFrom);
          s.events = s.events.filter((e) => e.endTs >= keepFrom);
        }
      }
    }
  }

  private add(o: Observation): string | null {
    const curId = this.currentByHex.get(o.hex);
    const cur = curId ? this.sessions.get(curId) : undefined;

    if (cur) {
      const last = cur.obs[cur.obs.length - 1];
      if (last) {
        // Out-of-order or repeated report of the same fix.
        if (o.ts <= last.ts) return null;
        if (o.ts - last.ts < config.session.duplicateSec * 1000 && o.lat === last.lat && o.lon === last.lon) return null;
      }
      if (!this.shouldSplit(cur, o, last)) {
        this.append(cur, o);
        return cur.id;
      }
    }

    const s: SessionInternal = {
      id: `${o.hex}-${o.callsign ?? 'nocs'}-${o.ts}`,
      hex: o.hex,
      callsign: o.callsign,
      startTs: o.ts,
      lastTs: o.ts,
      obs: [],
      events: [],
      landed: false,
      wasAirborne: false,
      groundSince: null,
      landedTs: null,
    };
    this.sessions.set(s.id, s);
    this.currentByHex.set(o.hex, s.id);
    this.append(s, o);
    return s.id;
  }

  private shouldSplit(cur: SessionInternal, o: Observation, last: Observation | undefined): boolean {
    const splitMs = config.session.splitGapSec * 1000;
    if (o.callsign && cur.callsign && o.callsign !== cur.callsign) return true;
    if (o.ts - cur.lastTs > splitMs) return true;
    if (!o.onGround && cur.groundSince !== null && o.ts - cur.groundSince > splitMs) return true;
    // Take-off after a landing. Guard against ground-flag flicker during the landing roll.
    if (cur.landed && last?.onGround && !o.onGround && cur.landedTs !== null) {
      const fastEnough = (o.gs ?? 0) > 80;
      if (fastEnough && o.ts - cur.landedTs > 30_000) return true;
    }
    return false;
  }

  private append(s: SessionInternal, o: Observation): void {
    const last = s.obs[s.obs.length - 1];
    if (!s.callsign && o.callsign) s.callsign = o.callsign;
    if (o.onGround) {
      if (s.groundSince === null) s.groundSince = o.ts;
      if (last && !last.onGround && s.wasAirborne && !s.landed) {
        s.landed = true;
        s.landedTs = o.ts;
      }
    } else {
      s.groundSince = null;
      s.wasAirborne = true;
    }
    s.obs.push(o);
    s.lastTs = o.ts;
  }
}
