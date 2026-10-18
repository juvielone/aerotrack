import type { FlightInsight } from './insights/types';

/** Raw aircraft record as returned by ADSB.lol (readsb format). Only fields we use. */
export interface RawAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  true_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  dbFlags?: number;
  lat?: number;
  lon?: number;
  seen_pos?: number;
  seen?: number;
}

/** One poll of the feed: either aircraft or an error (our side). */
export interface RawPoll {
  now: number;
  ac?: RawAircraft[];
  error?: string;
}

/** A single timestamped position report. */
export interface Observation {
  hex: string;
  callsign: string | null;
  /** Time of the position fix, ms since epoch (poll time minus seen_pos). */
  ts: number;
  lat: number;
  lon: number;
  /** Barometric altitude in ft; null when on the ground or unknown. */
  alt: number | null;
  onGround: boolean;
  gs: number | null;
  track: number | null;
  baroRate: number | null;
  squawk: string | null;
  emergency: string | null;
  category: string | null;
  type: string | null;
  reg: string | null;
  dbFlags: number;
  /** Set by cleaning: this altitude reading was rejected as a glitch. */
  glitch?: boolean;
}

export type EventType =
  | 'climb'
  | 'descent'
  | 'turn'
  | 'holding'
  | 'rapid-descent'
  | 'go-around'
  | 'go-around-hint'
  | 'squawk-7700'
  | 'squawk-7600'
  | 'glitch'
  | 'gap';

export type Severity = 'info' | 'notice' | 'warning' | 'alert';

export type GapCause = 'feed' | 'coverage' | 'unexpected';

export interface EventEvidence {
  startTs: number;
  endTs: number;
  startAlt?: number | null;
  endAlt?: number | null;
  rateFpm?: number;
  degrees?: number;
  direction?: 'left' | 'right';
  durationSec?: number;
  obsCount?: number;
  airport?: string;
  lowestAlt?: number;
  squawk?: string;
  rejectedAlt?: number;
  gapCause?: GapCause;
  lat?: number;
  lon?: number;
  /** Circling: displacement / path distance over the episode. */
  progressRatio?: number;
  confidence?: 'medium' | 'high';
}

export interface FlightEvent {
  id: string;
  type: EventType;
  severity: Severity;
  startTs: number;
  endTs: number;
  /** Still happening at the latest observation. */
  ongoing: boolean;
  evidence: EventEvidence;
  /** Plain-English, fact-first explanation. */
  text: string;
}

export type StatusTag =
  | 'Taxiing'
  | 'On ground'
  | 'Taking off'
  | 'Climbing'
  | 'Cruising'
  | 'Descending'
  | 'Approach'
  | 'Landed'
  | 'Airborne'
  | 'Unknown';

export interface SignalState {
  stale: boolean;
  secondsSinceLast: number;
  cause?: GapCause;
  text?: string;
}

export interface FlightSession {
  id: string;
  hex: string;
  callsign: string | null;
  startTs: number;
  lastTs: number;
  obs: Observation[];
  events: FlightEvent[];
  /** Observed an airborne → ground transition. */
  landed: boolean;
  /** Observed at least one airborne position. */
  wasAirborne: boolean;
}

/** Compact per-aircraft row sent to clients. */
export interface AircraftSummary {
  sessionId: string;
  hex: string;
  callsign: string | null;
  reg: string | null;
  type: string | null;
  category: string | null;
  dbFlags: number;
  lat: number;
  lon: number;
  alt: number | null;
  onGround: boolean;
  gs: number | null;
  track: number | null;
  baroRate: number | null;
  squawk: string | null;
  lastTs: number;
  status: StatusTag;
  signal: SignalState;
  /** Ongoing notable events (excludes routine climb/descent/turn). */
  notable: Pick<FlightEvent, 'id' | 'type' | 'severity' | 'text'>[];
  /** Highest severity rank among notable events, for sorting. */
  severityRank: number;
}

export interface FeedState {
  ok: boolean;
  lastOkTs: number | null;
  error: string | null;
  /** Feed considered down: poll failing, or mass simultaneous staleness. */
  down: boolean;
}

export interface Snapshot {
  now: number;
  feed: FeedState;
  aircraft: AircraftSummary[];
}

export interface SessionDetail {
  session: Omit<FlightSession, 'obs'> & {
    reg: string | null;
    type: string | null;
    category: string | null;
  };
  track: Pick<Observation, 'ts' | 'lat' | 'lon' | 'alt' | 'onGround' | 'gs' | 'glitch'>[];
  /** Index ranges [from, to] of track points separated by data gaps. */
  segments: [number, number][];
  status: StatusTag;
  signal: SignalState;
  insufficientHistory: boolean;
  /** Active and recent insights at the detail's time, highest priority first. */
  insights: FlightInsight[];
}
