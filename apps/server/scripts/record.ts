// Captures raw ADS-B polls to data/recordings/<name>.ndjson for offline replay.
// Each line is one poll: {"now": <ms>, "ac": [...]} or {"now": <ms>, "error": "..."} (feed failures replay too).
// Usage: npm run record -- --name syd-morning --minutes 60 [--title "..."] [--interval 5] [--provider adsblol|adsbfi]
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../src/env';
import { fetchPoll, PROVIDERS } from '../src/providers';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const recDir = join(env.dataDir, 'recordings');
const provider = PROVIDERS[arg('provider', env.provider.id)];
if (!provider) throw new Error(`Unknown provider. Use ${Object.keys(PROVIDERS).join(' | ')}`);
const intervalS = Math.max(5, Number(arg('interval', String(env.pollSeconds))));
const minutes = Number(arg('minutes', '60'));
const startedAt = new Date();
const name = arg('name', `syd-${startedAt.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
const title = arg('title', `Sydney traffic, ${startedAt.toISOString().slice(0, 10)}`);
const file = join(recDir, `${name}.ndjson`);

mkdirSync(recDir, { recursive: true });

const manifestPath = join(recDir, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
if (!manifest.some((r: { id: string }) => r.id === name)) {
  manifest.push({ id: name, title, file: `${name}.ndjson`, date: startedAt.toISOString(), source: provider.label, kind: 'live-capture', center: [env.lon, env.lat], zoom: 7 });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

let polls = 0;
async function poll() {
  try {
    const p = await fetchPoll(provider, env.lat, env.lon, env.radiusNm);
    appendFileSync(file, JSON.stringify(p) + '\n');
    if (polls++ % 12 === 0) console.log(`[record] ${new Date().toISOString()} poll ${polls}: ${p.ac?.length ?? 0} aircraft`);
  } catch (err) {
    appendFileSync(file, JSON.stringify({ now: Date.now(), error: err instanceof Error ? err.message : String(err) }) + '\n');
    console.warn(`[record] poll failed: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`[record] ${provider.label} → ${file} for ${minutes} min every ${intervalS}s`);
const end = Date.now() + minutes * 60_000;
await poll();
const timer = setInterval(() => {
  if (Date.now() >= end) {
    clearInterval(timer);
    console.log(`[record] done: ${polls} polls`);
    return;
  }
  void poll();
}, intervalS * 1000);
