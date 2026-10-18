import type {
    FlightInfo,
    FlightInsight
  } from "../types/flight";
  
  import { detectRapidDescent } from "./rapidDescent";
  import { detectSquawk } from "./squawk";
  import { detectTrackingGap } from "./trackingGap";
  import { detectPossibleCircling } from "./circling";
  import { detectPossibleGoAround } from "./goAround";
  
  export function analyseFlight(
    flight: FlightInfo
  ): FlightInsight[] {
  
    const insights: FlightInsight[] = [];
  
    const rapidDescent =
      detectRapidDescent(flight);
  
    if (rapidDescent) {
      insights.push(rapidDescent);
    }
  
    const squawk =
      detectSquawk(flight);
  
    if (squawk) {
      insights.push(squawk);
    }
  
    const trackingGap =
      detectTrackingGap(flight);
  
    if (trackingGap) {
      insights.push(trackingGap);
    }
  
    const circling =
      detectPossibleCircling(flight);
  
    if (circling) {
      insights.push(circling);
    }
  
    const goAround =
      detectPossibleGoAround(flight);
  
    if (goAround) {
      insights.push(goAround);
    }
  
    return insights;
  }