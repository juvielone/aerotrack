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
    /** Aircraft disappear from the map this long after their last position. */
    showStaleSec: 10 * 60,
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
    /** Below this ground speed the track is noise and is ignored (nothing holds or circles this slowly). */
    minTrackGsKt: 40,
  },
  holding: {
    minDeg: 300,
    windowSec: 6 * 60,
    /** "Roughly level": max altitude spread inside the window. */
    maxAltSpreadFt: 1500,
    /** Circling makes little forward progress: displacement / path distance at most this (teammate reference). */
    maxProgressRatio: 0.4,
    /** ...and comes back within this distance of an earlier position in the window (teammate reference). */
    returnWithinKm: 8,
    /** A racetrack has a straight leg this long between turns (thinned archive traces: measured by time). */
    straightLegSec: 30,
    /** ...with at least this much turning on each side of the leg, inside the window. */
    straightLegTurnDeg: 90,
    /** Without a straight leg, only continuous turning of 2+ laps counts: a single 360° orbit is a turn. */
    orbitOnlyMinDeg: 660,
    /** High confidence when it turned this much with this little progress. */
    highConfidenceDeg: 450,
    highConfidenceRatio: 0.25,
  },
  rapidDescent: {
    rateFpm: 5000,
    minObs: 3,
    minSec: 30,
    /** Real altitude lost across the run, on the glitch-cleaned series (teammate reference). */
    minLossFt: 2500,
    /** Large-descent rule (added 18 Oct 2026): this much lost within largeWindowSec at ≥ largeMinAvgFpm on average.
     *  A normal descent from cruise (~1,500–2,000 fpm) loses at most ~10,000 ft in 5 min and averages below 3,000. */
    largeLossFt: 10000,
    largeWindowSec: 5 * 60,
    largeMinAvgFpm: 3000,
    /** The large-descent window never spans a data gap longer than this. */
    largeMaxGapSec: 120,
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
    /** No destination is known inside the detectors, so the nearest airport within this range is used. */
    nearAirportKm: 30,
    approachMaxGsKt: 220,
    minApproachDescentFt: 300,
    climbFt: 1000,
    /** Without a ground observation, this slow below this height above the airport also counts as a landing. */
    landedMaxGsKt: 60,
    landedMaxAglFt: 200,
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
  notable: {
    /** Finished notable events stay in the notable-flights list this long. */
    lingerSec: 5 * 60,
  },
  /** Insights panel lifecycle (hysteresis). Times are against snapshot time: wall clock live, replay clock recorded. */
  insight: {
    /** An active insight must have lasted this long before the panel shows it. */
    minActiveSec: 10,
    /** After the condition stops being detected, it stays active this long before the panel reverts. */
    minClearedSec: {
      climb: 20,
      descent: 20,
      turn: 20,
      holding: 60,
      'rapid-descent': 20,
      'go-around-hint': 20,
      'squawk-7700': 0,
      'squawk-7600': 0,
    },
    /** Momentary insights (confirmed go-around, glitch, finished rapid descent) show as "Recent" this long. */
    recentSec: 120,
    /** "Position updates resumed after X min gap" shows this long. */
    resumedSec: 60,
    /** Highest first. The panel shows the first; the rest count towards "+N more". */
    priority: [
      'SQUAWK_7700',
      'SQUAWK_7600',
      'TRACKING_INTERRUPTED',
      'TRACKING_RESUMED',
      'RAPID_DESCENT',
      'POSSIBLE_CIRCLING',
      'GO_AROUND',
      'POSSIBLE_GO_AROUND',
      'CLIMB',
      'DESCENT',
      'TURN',
      'DATA_GLITCH',
    ],
  },
  coverage: {
    /** Fallback when no coverage grid is built: beyond this range from the centre counts as low coverage. */
    edgeNm: 220,
    gridDeg: 0.25,
  },
} as const;

export type Config = typeof config;
