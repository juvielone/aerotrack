import type {
    FlightInfo,
    FlightInsight
  } from "../types/flight";
  
  /**
   * Smallest signed difference between two headings.
   *
   * Example:
   * 359° -> 1° = 2°, NOT 358°.
   */
  function headingDifference(
    first: number,
    second: number
  ): number {
    let difference = second - first;
  
    while (difference > 180) {
      difference -= 360;
    }
  
    while (difference < -180) {
      difference += 360;
    }
  
    return difference;
  }
  
  /**
   * Distance between two lat/lon points in kilometres.
   */
  function distanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371;
  
    const toRad = (degrees: number) =>
      (degrees * Math.PI) / 180;
  
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
  
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
  
    return (
      2 *
      R *
      Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
      )
    );
  }
  
  export function detectPossibleCircling(
    flight: FlightInfo
  ): FlightInsight | null {
  
    const points = [
      ...flight.history,
      flight.current
    ]
      .filter(
        point =>
          Number.isFinite(point.lat) &&
          Number.isFinite(point.lon) &&
          point.headingDeg !== null
      )
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp
      );
  
    // Need enough points to see an actual pattern.
    if (points.length < 8) {
      return null;
    }
  
    // Don't run circling detection if the aircraft
    // is currently known to be on the ground.
    if (flight.current.onGround === true) {
      return null;
    }
  
    // Look at roughly the last 8 minutes.
    const latestTimestamp =
      points[points.length - 1].timestamp;
  
    const cutoff =
      latestTimestamp - 8 * 60 * 1000;
  
    const recent =
      points.filter(
        point =>
          point.timestamp >= cutoff
      );
  
    if (recent.length < 8) {
      return null;
    }
  
    // -------------------------
    // 1. Make sure this happened
    //    over a meaningful period.
    // -------------------------
  
    const durationMs =
      recent[recent.length - 1].timestamp -
      recent[0].timestamp;
  
    const durationMinutes =
      durationMs / 1000 / 60;
  
    if (durationMinutes < 4) {
      return null;
    }
  
    // -------------------------
    // 2. Add up heading changes.
    // -------------------------
  
    let totalHeadingChange = 0;
  
    for (
      let i = 1;
      i < recent.length;
      i++
    ) {
      const previous =
        recent[i - 1].headingDeg!;
  
      const current =
        recent[i].headingDeg!;
  
      const change =
        Math.abs(
          headingDifference(
            previous,
            current
          )
        );
  
      // Ignore tiny heading jitter.
      if (change >= 5) {
        totalHeadingChange += change;
      }
    }
  
    // Roughly a near-full rotation worth of
    // cumulative turning.
    if (totalHeadingChange < 300) {
      return null;
    }
  
    // -------------------------
    // 3. Calculate actual path
    //    distance travelled.
    // -------------------------
  
    let pathDistanceKm = 0;
  
    for (
      let i = 1;
      i < recent.length;
      i++
    ) {
      pathDistanceKm += distanceKm(
        recent[i - 1].lat,
        recent[i - 1].lon,
        recent[i].lat,
        recent[i].lon
      );
    }
  
    if (pathDistanceKm === 0) {
      return null;
    }
  
    // -------------------------
    // 4. How far is the aircraft
    //    from where it started?
    // -------------------------
  
    const first = recent[0];
    const last =
      recent[recent.length - 1];
  
    const displacementKm =
      distanceKm(
        first.lat,
        first.lon,
        last.lat,
        last.lon
      );
  
    const progressRatio =
      displacementKm /
      pathDistanceKm;
  
    // If it flew 60 km but only ended up
    // 8 km from where it started, that's
    // interesting.
    if (progressRatio > 0.4) {
      return null;
    }
  
    // -------------------------
    // 5. Check if it returned near
    //    an earlier position.
    // -------------------------
  
    let returnedNearEarlierPoint = false;
  
    // Don't compare only with the immediately
    // previous few points.
    for (
      let i = 0;
      i < recent.length - 4;
      i++
    ) {
      const distance =
        distanceKm(
          recent[i].lat,
          recent[i].lon,
          last.lat,
          last.lon
        );
  
      if (distance <= 8) {
        returnedNearEarlierPoint = true;
        break;
      }
    }
  
    if (!returnedNearEarlierPoint) {
      return null;
    }
  
    // -------------------------
    // Confidence
    // -------------------------
  
    const confidence:
      | "medium"
      | "high" =
        totalHeadingChange >= 450 &&
        progressRatio <= 0.25
          ? "high"
          : "medium";
  
    return {
      type:
        "POSSIBLE_CIRCLING",
  
      confidence,
  
      title:
        "Possible circling detected",
  
      observed:
        `The aircraft made repeated turns over approximately ${Math.round(
          durationMinutes
        )} minutes and ended relatively close to an earlier position.`,
  
      explanation:
        "The recent flight path shows repeated directional changes and limited forward progress, which may indicate circling or holding-like movement.",
  
      limitations:
        "FlightSense cannot confirm an ATC holding pattern or determine why the aircraft is circling from tracking data alone.",
  
      detectedAt:
        flight.current.timestamp
    };
  }