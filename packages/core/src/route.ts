import { distanceKm } from './geo';

export interface RouteAirport {
  iata: string | null;
  icao: string | null;
  name: string;
  lat: number;
  lon: number;
}

/** Planned route from static route data. Can be outdated: always labelled as such. */
export interface FlightRoute {
  callsign: string;
  origin: RouteAirport;
  destination: RouteAirport;
  source: 'ADSB.lol' | 'ADSBdb';
}

/**
 * Is the aircraft roughly between origin and destination? Guards against stale or reused callsigns:
 * if the position doesn't fit the route, we don't show it.
 */
export function routePlausible(route: Pick<FlightRoute, 'origin' | 'destination'>, lat: number, lon: number): boolean {
  const { origin: o, destination: d } = route;
  const direct = distanceKm(o.lat, o.lon, d.lat, d.lon);
  const via = distanceKm(o.lat, o.lon, lat, lon) + distanceKm(lat, lon, d.lat, d.lon);
  return via <= direct * 1.25 + 100;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Points along the great circle from `from` to `to` ([lon, lat] pairs), endpoints included. */
export function greatCircle(from: { lat: number; lon: number }, to: { lat: number; lon: number }, steps = 64): [number, number][] {
  const φ1 = rad(from.lat);
  const λ1 = rad(from.lon);
  const φ2 = rad(to.lat);
  const λ2 = rad(to.lon);
  const δ = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (δ < 1e-9) return [[from.lon, from.lat], [to.lon, to.lat]];
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = Math.sin((1 - f) * δ) / Math.sin(δ);
    const b = Math.sin(f * δ) / Math.sin(δ);
    const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
    const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
    const z = a * Math.sin(φ1) + b * Math.sin(φ2);
    out.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  out[0] = [from.lon, from.lat];
  out[steps] = [to.lon, to.lat];
  return out;
}
