import { airlineName, airlinePrefix } from './airlines';

export type AircraftClass = 'passenger' | 'other-powered' | 'rotorcraft' | 'military' | 'non-airliner';

export interface ClassInput {
  category: string | null;
  dbFlags: number;
  callsign: string | null;
}

/**
 * Coarse aircraft class for the type filter, from the ADS-B emitter `category` and `dbFlags` (bit 0 = military).
 * A0 / missing category is common on airliners, so an airline callsign counts as passenger.
 */
export function aircraftClass(a: ClassInput): AircraftClass {
  if (a.dbFlags & 1) return 'military';
  const c = a.category ?? '';
  if (c === 'A7') return 'rotorcraft';
  if (c.startsWith('B') || c.startsWith('C')) return 'non-airliner'; // gliders, balloons, UAVs, surface vehicles
  if (['A2', 'A3', 'A4', 'A5'].includes(c)) return 'passenger';
  if (airlinePrefix(a.callsign)) return 'passenger';
  return 'other-powered'; // light aircraft, GA, unknown
}

export const CLASS_LABEL: Record<AircraftClass, string> = {
  passenger: 'Passenger / airliners',
  'other-powered': 'Light & general aviation',
  rotorcraft: 'Helicopters',
  military: 'Military',
  'non-airliner': 'Gliders, balloons & drones',
};

export interface AirlineOption {
  icao: string;
  name: string;
  count: number;
}

/** Airlines actually seen in the coverage area, derived from callsign prefixes (not a hard-coded list). */
export function airlinesSeen(items: { callsign: string | null }[]): AirlineOption[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const p = airlinePrefix(it.callsign);
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([icao, count]) => ({ icao, name: airlineName(icao) ?? icao, count }))
    .sort((a, b) => b.count - a.count);
}
