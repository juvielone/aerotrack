import type {
    FlightInfo,
    FlightInsight
  } from "../types/flight";
  
  export function detectTrackingGap(
    flight: FlightInfo
  ): FlightInsight | null {
  
    const now = Date.now();
  
    const lastSeen =
      flight.current.timestamp;
  
    const gapMilliseconds =
      now - lastSeen;
  
    const gapSeconds =
      gapMilliseconds / 1000;
  
    // Example threshold:
    // if we haven't received a fresh position
    // for 2 minutes, flag it.
    if (gapSeconds < 120) {
      return null;
    }
  
    const gapMinutes =
      Math.round(gapSeconds / 60);
  
    return {
      type: "TRACKING_INTERRUPTED",
  
      confidence: "high",
  
      title:
        "Tracking interrupted",
  
      observed:
        `No new aircraft position has been received for approximately ${gapMinutes} minutes.`,
  
      explanation:
        "FlightSense has stopped receiving fresh position updates for this aircraft.",
  
      limitations:
        "The interruption could be caused by receiver coverage, upstream data availability, or another tracking issue. The cause cannot be determined from the gap alone.",
  
      detectedAt:
        lastSeen
    };
  }