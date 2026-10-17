import { distanceKm } from './geo';

export interface Airport {
  code: string;
  name: string;
  lat: number;
  lon: number;
  elevFt: number;
}

// Static reference data for "near an airport" checks. Coordinates are approximate (aerodrome reference points).
export const AIRPORTS: Airport[] = [
  { code: 'SYD', name: 'Sydney', lat: -33.9461, lon: 151.1772, elevFt: 21 },
  { code: 'BWU', name: 'Bankstown', lat: -33.9244, lon: 150.9883, elevFt: 29 },
  { code: 'RCM', name: 'Richmond (RAAF)', lat: -33.6006, lon: 150.7808, elevFt: 67 },
  { code: 'WSI', name: 'Western Sydney', lat: -33.8888, lon: 150.7186, elevFt: 260 },
  { code: 'CBR', name: 'Canberra', lat: -35.3069, lon: 149.195, elevFt: 1886 },
  { code: 'NTL', name: 'Newcastle', lat: -32.795, lon: 151.8344, elevFt: 31 },
  { code: 'WOL', name: 'Shellharbour', lat: -34.5611, lon: 150.7889, elevFt: 31 },
  { code: 'NOA', name: 'Nowra (HMAS Albatross)', lat: -34.9489, lon: 150.5369, elevFt: 400 },
  { code: 'CFS', name: 'Coffs Harbour', lat: -30.3206, lon: 153.1164, elevFt: 18 },
  { code: 'PQQ', name: 'Port Macquarie', lat: -31.4358, lon: 152.8633, elevFt: 12 },
  { code: 'TRO', name: 'Taree', lat: -31.8886, lon: 152.5139, elevFt: 38 },
  { code: 'TMW', name: 'Tamworth', lat: -31.0839, lon: 150.8467, elevFt: 1334 },
  { code: 'ARM', name: 'Armidale', lat: -30.5281, lon: 151.6172, elevFt: 3556 },
  { code: 'DBO', name: 'Dubbo', lat: -32.2167, lon: 148.5747, elevFt: 935 },
  { code: 'OAG', name: 'Orange', lat: -33.3817, lon: 149.1328, elevFt: 3115 },
  { code: 'BHS', name: 'Bathurst', lat: -33.4094, lon: 149.6517, elevFt: 2435 },
  { code: 'PKE', name: 'Parkes', lat: -33.1314, lon: 148.2394, elevFt: 1069 },
  { code: 'WGA', name: 'Wagga Wagga', lat: -35.1653, lon: 147.4664, elevFt: 724 },
  { code: 'MYA', name: 'Moruya', lat: -35.8978, lon: 150.1442, elevFt: 14 },
  { code: 'MIM', name: 'Merimbula', lat: -36.9086, lon: 149.9014, elevFt: 7 },
  { code: 'ABX', name: 'Albury', lat: -36.0678, lon: 146.9581, elevFt: 539 },
  { code: 'LHI', name: 'Lord Howe Island', lat: -31.5383, lon: 159.0769, elevFt: 5 },
  { code: 'BNK', name: 'Ballina', lat: -28.8339, lon: 153.5622, elevFt: 7 },
  { code: 'OOL', name: 'Gold Coast', lat: -28.1644, lon: 153.5047, elevFt: 21 },
  { code: 'BNE', name: 'Brisbane', lat: -27.3842, lon: 153.1175, elevFt: 13 },
  { code: 'MEL', name: 'Melbourne', lat: -37.6733, lon: 144.8433, elevFt: 434 },
  { code: 'AVV', name: 'Avalon', lat: -38.0394, lon: 144.4694, elevFt: 35 },
  { code: 'HBA', name: 'Hobart', lat: -42.8361, lon: 147.5103, elevFt: 13 },
  { code: 'LST', name: 'Launceston', lat: -41.5453, lon: 147.2142, elevFt: 562 },
  { code: 'ADL', name: 'Adelaide', lat: -34.945, lon: 138.5306, elevFt: 20 },
  { code: 'PER', name: 'Perth', lat: -31.9403, lon: 115.9669, elevFt: 67 },
  { code: 'MCY', name: 'Sunshine Coast', lat: -26.6033, lon: 153.0911, elevFt: 15 },
  { code: 'CNS', name: 'Cairns', lat: -16.8858, lon: 145.7553, elevFt: 10 },
  { code: 'DRW', name: 'Darwin', lat: -12.4147, lon: 130.8767, elevFt: 103 },
  { code: 'AKL', name: 'Auckland', lat: -37.0081, lon: 174.7917, elevFt: 23 },
];

export function nearestAirport(lat: number, lon: number, withinKm: number): { airport: Airport; km: number } | null {
  let best: { airport: Airport; km: number } | null = null;
  for (const airport of AIRPORTS) {
    const km = distanceKm(lat, lon, airport.lat, airport.lon);
    if (km <= withinKm && (!best || km < best.km)) best = { airport, km };
  }
  return best;
}
