import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS } from './providers';

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const providerId = process.env.AEROTRACK_PROVIDER ?? 'adsblol';
if (!PROVIDERS[providerId]) throw new Error(`Unknown AEROTRACK_PROVIDER "${providerId}" (use ${Object.keys(PROVIDERS).join(' | ')})`);

export const env = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST ?? '127.0.0.1',
  provider: PROVIDERS[providerId],
  lat: num(process.env.AEROTRACK_LAT, -33.9461),
  lon: num(process.env.AEROTRACK_LON, 151.1772),
  radiusNm: num(process.env.AEROTRACK_RADIUS_NM, 250),
  pollSeconds: Math.max(5, num(process.env.AEROTRACK_POLL_SECONDS, 5)),
  /** Set to "false" to run fully offline (recorded mode only). */
  liveEnabled: process.env.AEROTRACK_LIVE !== 'false',
  /** Also list captures and other recordings in the Recorded tab, not just the demo examples. */
  showCaptures: process.env.AEROTRACK_SHOW_CAPTURES === 'true',
  dataDir: process.env.AEROTRACK_DATA_DIR ?? join(ROOT, 'data'),
  webDist: join(ROOT, 'apps', 'web', 'dist'),
};
