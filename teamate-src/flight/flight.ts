export type AirportInfo = {
    code: string | null;
    name: string | null;
    lat: number | null;
    lon: number | null;
    elevationFt: number | null;
  };
  
  export type FlightPoint = {
    timestamp: number;
  
    lat: number;
    lon: number;
  
    altitudeFt: number | null;
    verticalRateFpm: number | null;
    groundSpeedKt: number | null;
    headingDeg: number | null;
  
    squawk: string | null;
    onGround?: boolean;
  };
  
  export type FlightInfo = {
    id: string;
  
    callsign: string | null;
    flightNumber: string | null;
  
    airline: string | null;
    aircraftType: string | null;
  
    origin: AirportInfo | null;
    destination: AirportInfo | null;
  
    current: FlightPoint;
  
    history: FlightPoint[];
  };

  export type InsightType =
  | "POSSIBLE_CIRCLING"
  | "RAPID_DESCENT"
  | "SQUAWK_7600"
  | "SQUAWK_7700"
  | "SQUAWK_7500"
  | "TRACKING_INTERRUPTED"
  | "POSSIBLE_GO_AROUND";

  export type FlightInsight = {
  type: InsightType;
  confidence?: "low" | "medium" | "high";
  title: string;
  observed: string;
  explanation: string;
  limitations?: string;
  detectedAt?: number;
  };