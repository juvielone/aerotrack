import type {
    FlightInfo,
    FlightInsight
  } from "../types/flight";
  
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
  
  export function detectPossibleGoAround(
    flight: FlightInfo
  ): FlightInsight | null {
  
    // We need a known destination airport.
    if (
      !flight.destination ||
      flight.destination.lat === null ||
      flight.destination.lon === null
    ) {
      return null;
    }
  
    const points = [
      ...flight.history,
      flight.current
    ].filter(
      point =>
        point.altitudeFt !== null
    );
  
    // Need enough history to see:
    // descent -> low point -> climb.
    if (points.length < 8) {
      return null;
    }
  
    // Only inspect recent observations.
    const recent = points.slice(-15);
  
    const airportElevation =
      flight.destination.elevationFt ?? 0;
  
    const enriched = recent.map(point => ({
      ...point,
  
      distanceToAirportKm: distanceKm(
        point.lat,
        point.lon,
        flight.destination!.lat!,
        flight.destination!.lon!
      ),
  
      altitudeAboveAirportFt:
        point.altitudeFt! - airportElevation
    }));
  
    // Aircraft must have been reasonably close
    // to the destination and relatively low.
    const approachPoints = enriched.filter(
      point =>
        point.distanceToAirportKm <= 30 &&
        point.altitudeAboveAirportFt <= 5000
    );
  
    if (approachPoints.length < 6) {
      return null;
    }
  
    // Find the lowest altitude point.
    let lowestIndex = 0;
  
    for (
      let i = 1;
      i < approachPoints.length;
      i++
    ) {
      if (
        approachPoints[i].altitudeAboveAirportFt <
        approachPoints[lowestIndex].altitudeAboveAirportFt
      ) {
        lowestIndex = i;
      }
    }
  
    // Need points before AND after the low point.
    if (
      lowestIndex < 2 ||
      lowestIndex >
        approachPoints.length - 3
    ) {
      return null;
    }
  
    const lowPoint =
      approachPoints[lowestIndex];
  
    const before =
      approachPoints.slice(
        Math.max(0, lowestIndex - 4),
        lowestIndex
      );
  
    const after =
      approachPoints.slice(
        lowestIndex + 1,
        lowestIndex + 5
      );
  
    // -------------------------
    // Was the aircraft descending?
    // -------------------------
  
    const descendingSamples =
      before.filter(
        point =>
          point.verticalRateFpm !== null &&
          point.verticalRateFpm <= -300
      ).length;
  
    const altitudeBefore =
      before[0].altitudeAboveAirportFt;
  
    const descentAmountFt =
      altitudeBefore -
      lowPoint.altitudeAboveAirportFt;
  
    const wasDescending =
      descendingSamples >= 2 ||
      descentAmountFt >= 500;
  
    if (!wasDescending) {
      return null;
    }
  
    // -------------------------
    // Did it then start climbing?
    // -------------------------
  
    const climbingSamples =
      after.filter(
        point =>
          point.verticalRateFpm !== null &&
          point.verticalRateFpm >= 700
      ).length;
  
    const highestAfter =
      Math.max(
        ...after.map(
          point =>
            point.altitudeAboveAirportFt
        )
      );
  
    const climbAfterLowPointFt =
      highestAfter -
      lowPoint.altitudeAboveAirportFt;
  
    const sustainedClimb =
      climbingSamples >= 2 &&
      climbAfterLowPointFt >= 700;
  
    if (!sustainedClimb) {
      return null;
    }
  
    // -------------------------
    // Make sure it didn't land.
    // -------------------------
  
    if (lowPoint.onGround === true) {
      return null;
    }
  
    // If speed became very low, this may have
    // been a landing/taxi situation instead.
    if (
      lowPoint.groundSpeedKt !== null &&
      lowPoint.groundSpeedKt < 60
    ) {
      return null;
    }
  
    // -------------------------
    // Confidence
    // -------------------------
  
    const confidence:
      | "medium"
      | "high" =
        lowPoint.altitudeAboveAirportFt <= 1500 &&
        climbAfterLowPointFt >= 1200 &&
        climbingSamples >= 3
          ? "high"
          : "medium";
  
    return {
      type: "POSSIBLE_GO_AROUND",
  
      confidence,
  
      title:
        "Possible go-around detected",
  
      observed:
        `The aircraft descended to approximately ${Math.max(
          0,
          Math.round(
            lowPoint.altitudeAboveAirportFt
          )
        ).toLocaleString()} ft above the destination airport, then climbed approximately ${Math.round(
          climbAfterLowPointFt
        ).toLocaleString()} ft.`,
  
      explanation:
        "A descent followed by a sustained climb close to the destination may indicate a go-around.",
  
      limitations:
        "Tracking data alone cannot confirm that a go-around occurred or determine why the aircraft climbed away.",
  
      detectedAt:
        after[after.length - 1]?.timestamp ??
        flight.current.timestamp
    };
  }