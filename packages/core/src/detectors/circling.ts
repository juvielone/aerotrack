// Adapted from teamate-src/detector/circling.ts
import { config } from '../config';
import { distanceKm } from '../geo';
import type { Observation } from '../types';

export interface CirclingShape {
  pathKm: number;
  displacementKm: number;
  /** Displacement / path distance: near 0 when the aircraft ends up where it started. */
  progressRatio: number;
  /** The last position is close to an earlier one (not just the last few points). */
  returnedNearEarlierPoint: boolean;
}

/** Points compared against the last one skip this many of the most recent (they are always close). */
const SKIP_RECENT = 4;

/** Path shape of a window of positions; null when there is no movement to measure. */
export function circlingShape(points: Pick<Observation, 'lat' | 'lon'>[]): CirclingShape | null {
  if (points.length < 2) return null;
  let pathKm = 0;
  for (let i = 1; i < points.length; i++) pathKm += distanceKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  if (pathKm === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const displacementKm = distanceKm(first.lat, first.lon, last.lat, last.lon);
  let returnedNearEarlierPoint = false;
  for (let i = 0; i < points.length - SKIP_RECENT; i++) {
    if (distanceKm(points[i].lat, points[i].lon, last.lat, last.lon) <= config.holding.returnWithinKm) {
      returnedNearEarlierPoint = true;
      break;
    }
  }
  return { pathKm, displacementKm, progressRatio: displacementKm / pathKm, returnedNearEarlierPoint };
}

/** Repeated turning with little forward progress that comes back near an earlier position. */
export function looksLikeCircling(shape: CirclingShape | null): boolean {
  return !!shape && shape.progressRatio <= config.holding.maxProgressRatio && shape.returnedNearEarlierPoint;
}

export function circlingConfidence(degrees: number, shape: CirclingShape): 'medium' | 'high' {
  const h = config.holding;
  return degrees >= h.highConfidenceDeg && shape.progressRatio <= h.highConfidenceRatio ? 'high' : 'medium';
}
