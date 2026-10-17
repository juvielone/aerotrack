// Looks up planned routes for every callsign in a recording (while online) so offline replays can show them.
// Usage: npm run routes:prefetch -- --recording <id>   (omit --recording to do all recordings)
import { airlinePrefix, normalizePoll } from '@aerotrack/core';
import { RouteService } from '../src/flightRoutes';
import { getRecording, listRecordings } from '../src/recordings';

const i = process.argv.indexOf('--recording');
const ids = i >= 0 ? [process.argv[i + 1]] : listRecordings().map((r) => r.id);
const routes = new RouteService();

for (const id of ids) {
  const rec = getRecording(id);
  if (!rec) {
    console.error(`[routes] no recording "${id}"`);
    continue;
  }
  // One position per callsign (the last seen) is enough for the lookup.
  const seen = new Map<string, { lat: number; lon: number }>();
  for (const poll of rec.polls) for (const o of normalizePoll(poll)) if (o.callsign && airlinePrefix(o.callsign)) seen.set(o.callsign, { lat: o.lat, lon: o.lon });
  let found = 0;
  for (const [cs, pos] of seen) {
    if (await routes.lookup(cs, pos.lat, pos.lon)) found++;
  }
  console.log(`[routes] ${id}: ${found} of ${seen.size} airline callsigns have a route`);
}
routes.flush();
