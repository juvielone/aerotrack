import type {
    FlightInfo,
    FlightInsight
  } from "../types/flight";
  
  export function detectRapidDescent(
    flight: FlightInfo
  ): FlightInsight | null {
  
    const points = [
      ...flight.history,
      flight.current
    ];
  
    // Not enough data yet to detect a pattern.
    if (points.length < 4) {
      return null;
    }
  
    // Only look at the most recent observations.
    const recent = points.slice(-8);
  
    const valid = recent.filter(
      point =>
        point.altitudeFt !== null &&
        point.verticalRateFpm !== null
    );
  
    if (valid.length < 4) {
      return null;
    }
  
    const first = valid[0];
    const last = valid[valid.length - 1];
  
    const durationSeconds =
      (last.timestamp - first.timestamp) / 1000;
  
    // Don't trigger from a few observations
    // collected almost instantly.
    if (durationSeconds < 30) {
      return null;
    }
  
    const altitudeLossFt =
      first.altitudeFt! -
      last.altitudeFt!;
  
    const strongDescentSamples =
      valid.filter(
        point =>
          point.verticalRateFpm! <= -4000
      ).length;
  
    // Require BOTH:
    // - several strong descent readings
    // - real altitude loss
    if (
      strongDescentSamples < 3 ||
      altitudeLossFt < 2500
    ) {
      return null;
    }
  
    const confidence =
      strongDescentSamples >= 4 &&
      altitudeLossFt >= 4000
        ? "high"
        : "medium";
  
    return {
      type: "RAPID_DESCENT",
  
      confidence,
  
      title:
        "Rapid descent detected",
  
      observed:
        `The aircraft lost approximately ${Math.round(
          altitudeLossFt
        ).toLocaleString()} ft across recent observations.`,
  
      explanation:
        "Multiple consecutive tracking updates indicate a high rate of descent.",
  
      limitations:
        "FlightSense cannot determine the cause of the descent from tracking data alone.",
  
      detectedAt:
        last.timestamp
    };
  }