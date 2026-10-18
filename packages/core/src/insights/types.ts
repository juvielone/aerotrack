// Adapted from teamate-src/flight/flight.ts

/** One position in a recorded-flight file (data/recorded/*.json). */
export interface FlightPoint {
  /** Position time in ms since epoch (poll time minus seen_pos), not poll time. */
  timestamp: number;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  verticalRateFpm: number | null;
  groundSpeedKt: number | null;
  headingDeg: number | null;
  squawk: string | null;
  /** ADSB.lol `emergency` field: "general" counts as 7700, "nordo" as 7600. */
  emergency: string | null;
  onGround?: boolean;
}

export interface AirportInfo {
  code: string | null;
  name: string | null;
  lat: number | null;
  lon: number | null;
  elevationFt: number | null;
}

export type InsightType =
  | 'SQUAWK_7700'
  | 'SQUAWK_7600'
  /** Kept as a type only: never emitted (a false hijack code is too alarming for our audience). */
  | 'SQUAWK_7500'
  | 'TRACKING_INTERRUPTED'
  | 'TRACKING_RESUMED'
  | 'RAPID_DESCENT'
  | 'POSSIBLE_CIRCLING'
  | 'GO_AROUND'
  | 'POSSIBLE_GO_AROUND'
  | 'CLIMB'
  | 'DESCENT'
  | 'TURN'
  | 'DATA_GLITCH';

export interface InsightEvidence {
  windowStart: number;
  windowEnd: number;
  /** Altitude in ft at the start / end of the window, when known. */
  startValue?: number;
  endValue?: number;
  /** Vertical rate in ft/min (negative = descending). */
  rate?: number;
  /** Cumulative track change for turns and circling. */
  degrees?: number;
  sampleCount?: number;
}

export interface FlightInsight {
  /** Stable across polls: the detector event id, or a fixed id for signal state. */
  id: string;
  type: InsightType;
  /** active = still detected (or within its cleared hysteresis); recent = a momentary insight shown for a while. */
  status: 'active' | 'recent';
  confidence?: 'low' | 'medium' | 'high';
  title: string;
  observed: string;
  explanation: string;
  limitations?: string;
  /** When the pattern started. */
  detectedAt: number;
  /** When the condition was last seen in the data. */
  lastSeenAt: number;
  evidence: InsightEvidence;
  /** Timeline event this insight comes from (absent for live signal state). */
  eventId?: string;
}
