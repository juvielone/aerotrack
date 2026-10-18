import type {
    FlightInfo,
    FlightInsight
  } from "../types/flight";
  
  export function detectSquawk(
    flight: FlightInfo
  ): FlightInsight | null {
  
    const squawk = flight.current.squawk;
  
    if (!squawk) {
      return null;
    }
  
    if (squawk === "7700") {
      return {
        type: "SQUAWK_7700",
        title: "General emergency code detected",
        observed:
          "The aircraft is transmitting squawk 7700.",
        explanation:
          "Squawk 7700 is associated with a general emergency.",
        limitations:
          "FlightSense cannot determine the nature or severity of the situation from the code alone.",
        detectedAt: flight.current.timestamp
      };
    }
  
    if (squawk === "7600") {
      return {
        type: "SQUAWK_7600",
        title: "Radio communication failure code detected",
        observed:
          "The aircraft is transmitting squawk 7600.",
        explanation:
          "Squawk 7600 is associated with radio communication failure.",
        limitations:
          "FlightSense cannot determine the cause or operational impact from the code alone.",
        detectedAt: flight.current.timestamp
      };
    }
  
    if (squawk === "7500") {
      return {
        type: "SQUAWK_7500",
        title: "Unlawful interference code detected",
        observed:
          "The aircraft is transmitting squawk 7500.",
        explanation:
          "Squawk 7500 is associated with unlawful interference.",
        limitations:
          "FlightSense only reports the transmitted code and cannot independently verify the circumstances.",
        detectedAt: flight.current.timestamp
      };
    }
  
    return null;
  }