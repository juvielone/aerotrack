import { describe, expect, it } from 'vitest';
import { greatCircle, routePlausible } from '../src/route';

const BNE = { iata: 'BNE', icao: 'YBBN', name: 'Brisbane', lat: -27.3842, lon: 153.1175 };
const SYD = { iata: 'SYD', icao: 'YSSY', name: 'Sydney', lat: -33.9461, lon: 151.1772 };

describe('route plausibility', () => {
  it('accepts an aircraft between origin and destination', () => {
    expect(routePlausible({ origin: BNE, destination: SYD }, -32.9, 151.5)).toBe(true);
  });
  it('rejects a route that does not match the position (stale or reused callsign)', () => {
    expect(routePlausible({ origin: BNE, destination: SYD }, -37.67, 144.84)).toBe(false);
  });
});

describe('great circle', () => {
  it('starts and ends at the endpoints', () => {
    const pts = greatCircle(BNE, SYD, 16);
    expect(pts).toHaveLength(17);
    expect(pts[0]).toEqual([BNE.lon, BNE.lat]);
    expect(pts[16]).toEqual([SYD.lon, SYD.lat]);
    const mid = pts[8];
    expect(mid[1]).toBeLessThan(BNE.lat);
    expect(mid[1]).toBeGreaterThan(SYD.lat);
  });
});
