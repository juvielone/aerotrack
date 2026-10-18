import { describe, expect, it } from 'vitest';
import { iconClass, type IconInput } from '../src/iconClass';

const ic = (over: Partial<IconInput>) => iconClass({ type: null, category: null, dbFlags: 0, callsign: null, ...over });

describe('aircraft icon class', () => {
  it('picks the silhouette from the ICAO type designator', () => {
    expect(ic({ type: 'A21N' })).toBe('narrow'); // VH-OYF (JQ38)
    expect(ic({ type: 'B738' })).toBe('narrow'); // VH-VZV, VH-IJR
    expect(ic({ type: 'B38M' })).toBe('narrow');
    expect(ic({ type: 'B77W' })).toBe('wide');
    expect(ic({ type: 'B789' })).toBe('wide');
    expect(ic({ type: 'A359' })).toBe('wide');
    expect(ic({ type: 'A388' })).toBe('heavy4');
    expect(ic({ type: 'B744' })).toBe('heavy4');
    expect(ic({ type: 'DH8D' })).toBe('turboprop');
    expect(ic({ type: 'AT76' })).toBe('turboprop');
    expect(ic({ type: 'C130' })).toBe('turboprop'); // not a Cessna single
    expect(ic({ type: 'C208' })).toBe('turboprop');
    expect(ic({ type: 'C172' })).toBe('light');
    expect(ic({ type: 'AC50' })).toBe('light'); // VH-UJV
    expect(ic({ type: 'C56X' })).toBe('bizjet');
    expect(ic({ type: 'GLF6' })).toBe('bizjet');
    expect(ic({ type: 'EC35' })).toBe('helicopter');
    expect(ic({ type: 'R44' })).toBe('helicopter');
    expect(ic({ type: 'F18', dbFlags: 1 })).toBe('fighter');
    expect(ic({ type: 'GLID' })).toBe('glider');
  });

  it('falls back to the ADS-B category when the type is unknown', () => {
    expect(ic({ type: 'ZZZZ', category: 'A5' })).toBe('wide');
    expect(ic({ category: 'A7' })).toBe('helicopter');
    expect(ic({ category: 'A1' })).toBe('light');
    expect(ic({ category: 'B1' })).toBe('glider');
  });

  it('falls back to the callsign when type and category are missing', () => {
    expect(ic({ callsign: 'QFA12' })).toBe('narrow');
    expect(ic({ callsign: 'VHUJV' })).toBe('light');
    expect(ic({})).toBe('light');
  });
});
