export interface Airline {
  iata: string;
  icao: string;
  name: string;
}

// Airline prefixes for flight-number → callsign search (QF1 → QFA1) and display names.
// Names only; the airline filter list itself is derived from callsigns seen in recent data.
export const AIRLINES: Airline[] = [
  { iata: 'QF', icao: 'QFA', name: 'Qantas' },
  { iata: 'QF', icao: 'QLK', name: 'QantasLink' },
  { iata: 'VA', icao: 'VOZ', name: 'Virgin Australia' },
  { iata: 'JQ', icao: 'JST', name: 'Jetstar' },
  { iata: 'ZL', icao: 'RXA', name: 'Rex' },
  { iata: 'QQ', icao: 'UTY', name: 'Alliance Airlines' },
  { iata: 'FD', icao: 'FRE', name: 'Fly Corporate' },
  { iata: 'NZ', icao: 'ANZ', name: 'Air New Zealand' },
  { iata: 'SQ', icao: 'SIA', name: 'Singapore Airlines' },
  { iata: 'TR', icao: 'TGW', name: 'Scoot' },
  { iata: 'EK', icao: 'UAE', name: 'Emirates' },
  { iata: 'QR', icao: 'QTR', name: 'Qatar Airways' },
  { iata: 'EY', icao: 'ETD', name: 'Etihad' },
  { iata: 'CX', icao: 'CPA', name: 'Cathay Pacific' },
  { iata: 'UA', icao: 'UAL', name: 'United' },
  { iata: 'DL', icao: 'DAL', name: 'Delta' },
  { iata: 'AA', icao: 'AAL', name: 'American Airlines' },
  { iata: 'AC', icao: 'ACA', name: 'Air Canada' },
  { iata: 'HA', icao: 'HAL', name: 'Hawaiian' },
  { iata: 'JL', icao: 'JAL', name: 'Japan Airlines' },
  { iata: 'NH', icao: 'ANA', name: 'ANA' },
  { iata: 'KE', icao: 'KAL', name: 'Korean Air' },
  { iata: 'OZ', icao: 'AAR', name: 'Asiana' },
  { iata: 'CA', icao: 'CCA', name: 'Air China' },
  { iata: 'MU', icao: 'CES', name: 'China Eastern' },
  { iata: 'CZ', icao: 'CSN', name: 'China Southern' },
  { iata: 'BR', icao: 'EVA', name: 'EVA Air' },
  { iata: 'CI', icao: 'CAL', name: 'China Airlines' },
  { iata: 'MH', icao: 'MAS', name: 'Malaysia Airlines' },
  { iata: 'D7', icao: 'XAX', name: 'AirAsia X' },
  { iata: 'GA', icao: 'GIA', name: 'Garuda Indonesia' },
  { iata: 'TG', icao: 'THA', name: 'Thai Airways' },
  { iata: 'VN', icao: 'HVN', name: 'Vietnam Airlines' },
  { iata: 'PR', icao: 'PAL', name: 'Philippine Airlines' },
  { iata: '5J', icao: 'CEB', name: 'Cebu Pacific' },
  { iata: 'FJ', icao: 'FJI', name: 'Fiji Airways' },
  { iata: 'NF', icao: 'AVN', name: 'Air Vanuatu' },
  { iata: 'IE', icao: 'SOL', name: 'Solomon Airlines' },
  { iata: 'PX', icao: 'ANG', name: 'Air Niugini' },
  { iata: 'SB', icao: 'ACI', name: 'Aircalin' },
  { iata: 'LA', icao: 'LAN', name: 'LATAM' },
  { iata: 'AI', icao: 'AIC', name: 'Air India' },
  { iata: 'TK', icao: 'THY', name: 'Turkish Airlines' },
  { iata: 'BA', icao: 'BAW', name: 'British Airways' },
];

const byIcao = new Map(AIRLINES.map((a) => [a.icao, a]));

/** ICAO airline prefix of a callsign (e.g. "QFA12" → "QFA"), or null for registrations / non-airline callsigns. */
export function airlinePrefix(callsign: string | null): string | null {
  if (!callsign) return null;
  const m = /^([A-Z]{3})\d/.exec(callsign);
  return m ? m[1] : null;
}

export function airlineName(icao: string): string | null {
  return byIcao.get(icao)?.name ?? null;
}

export function icaoForIata(iata: string): string[] {
  return AIRLINES.filter((a) => a.iata === iata).map((a) => a.icao);
}
