import { config } from './config';
import { distanceKm, KM_PER_NM } from './geo';

/** Low-coverage zones built from historical point density (scripts/buildCoverage.ts). */
export interface CoverageGrid {
  gridDeg: number;
  center: [number, number]; // [lon, lat]
  /** Cells with data: key "latIdx:lonIdx" → point count. */
  cells: Record<string, number>;
  /** Cells judged low-coverage (sparse points, or where aircraft often drop out). */
  low: string[];
}

export function cellKey(lat: number, lon: number, gridDeg: number): string {
  return `${Math.floor(lat / gridDeg)}:${Math.floor(lon / gridDeg)}`;
}

export class CoverageModel {
  private low: Set<string>;

  constructor(
    private grid: CoverageGrid | null,
    private center: [number, number] = [151.1772, -33.9461],
  ) {
    this.low = new Set(grid?.low ?? []);
  }

  isLowCoverage = (lat: number, lon: number): boolean => {
    if (this.grid) {
      const key = cellKey(lat, lon, this.grid.gridDeg);
      return !(key in this.grid.cells) || this.low.has(key);
    }
    // No grid built yet: treat the edge of our receiver range as low coverage.
    return distanceKm(lat, lon, this.center[1], this.center[0]) > config.coverage.edgeNm * KM_PER_NM;
  };

  /** Low cells as polygons for the map. */
  lowCellPolygons(): [number, number][][] {
    if (!this.grid) return [];
    const d = this.grid.gridDeg;
    return [...this.low].map((k) => {
      const [la, lo] = k.split(':').map(Number);
      const lat = la * d;
      const lon = lo * d;
      return [
        [lon, lat],
        [lon + d, lat],
        [lon + d, lat + d],
        [lon, lat + d],
        [lon, lat],
      ];
    });
  }
}
