// Every tunable threshold lives here (PRD §4). Units are in the names.
export const config = {
  session: {
    /** Unseen or on the ground for longer than this ends the flight session. */
    splitGapSec: 20 * 60,
    /** Live mode keeps this much history per session. */
    historyWindowSec: 45 * 60,
    /** Sessions unseen for longer than this are dropped from memory. */
    dropAfterSec: 30 * 60,
    /** Two observations closer than this with the same position are duplicates. */
    duplicateSec: 1,
  },
  stale: {
    /** seen_pos / time since last position above this = signal lost (PRD: > 60 s). */
    staleSec: 60,
    /** If at least this share of aircraft (and at least `feedMinAircraft`) go stale together, blame our feed. */
    feedStaleShare: 0.8,
    feedMinAircraft: 5,
    /** No successful poll for this long = our feed is down. */
    feedDownSec: 20,
  },
  vertical: {
    /** Sustained climb/descent: ±altFt over ≥ windowSec with ≥ minObs, or |baro_rate| > rateFpm sustained. */
    altFt: 1000,
    windowSec: 60,
    minObs: 4,
    rateFpm: 500,
  },
  turn: {
    minDeg: 30,
    windowSec: 90,
    /** Per-sample track changes smaller than this are noise. */
    noiseDeg: 5,
    /** A run of turning survives straight segments up to this long. */
    maxStraightSec: 30,
  },
  holding: {
    minDeg: 300,
    windowSec: 6 * 60,
    /** "Roughly level": max altitude spread inside the window. */
    maxAltSpreadFt: 1500,
  },
  rapidDescent: {
    rateFpm: 5000,
    minObs: 3,
    minSec: 30,
  },
  glitch: {
    /** Implied vertical rate above this is physically implausible. */
    impliedRateFpm: 20000,
    /** The bad value must revert within this many samples. */
    revertSamples: 2,
    revertToleranceFt: 600,
  },
  goAround: {
    /** Approach segment: below this height above the airport. */
    approachAglFt: 2000,
    nearAirportKm: 15,
    approachMaxGsKt: 220,
    minApproachDescentFt: 300,
    climbFt: 1000,
    /** Live mode shows nothing before confirmation (PRD §4.2 [OPEN], conservative default). */
    showUnconfirmedHint: false,
  },
  status: {
    taxiMinKt: 3,
    taxiMaxKt: 40,
    takeoffWindowSec: 60,
    cruiseMinFt: 20000,
    approachMaxFt: 5000,
    approachNearKm: 40,
    /** At least this many observations before we describe anything. */
    minObs: 3,
  },
  coverage: {
    /** Fallback when no coverage grid is built: beyond this range from the centre counts as low coverage. */
    edgeNm: 220,
    gridDeg: 0.25,
  },
} as const;

export type Config = typeof config;
