import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply } from 'fastify';
import { AIRPORTS, CoverageModel, routePlausible, type CoverageGrid } from '@aerotrack/core';
import { env } from './env';
import { RouteService } from './flightRoutes';
import { LiveFeed } from './live';
import { getRecording, listRecordings } from './recordings';
import { Replay, SPEEDS } from './replay';

function loadCoverage(): CoverageModel {
  const path = join(env.dataDir, 'coverage-grid.json');
  const grid: CoverageGrid | null = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  if (grid) console.log(`[coverage] loaded ${grid.low.length} low-coverage cells`);
  return new CoverageModel(grid, [env.lon, env.lat]);
}

const coverage = loadCoverage();
const live = new LiveFeed(coverage);
const replays = new Map<string, Replay>();
const routes = new RouteService();

const app = Fastify({ logger: false });

/** Server-sent events: a long-lived response the browser reads with EventSource. */
function openSse(reply: FastifyReply, onClose: () => void) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
  reply.raw.on('close', () => {
    clearInterval(heartbeat);
    onClose();
  });
  return send;
}

app.get('/api/config', async () => ({
  center: [env.lon, env.lat],
  radiusNm: env.radiusNm,
  live: { enabled: env.liveEnabled, source: live.provider.label, pollSeconds: env.pollSeconds },
  airports: AIRPORTS,
  lowCoverage: coverage.lowCellPolygons(),
  speeds: SPEEDS,
}));

app.get('/api/health', async () => ({ ok: true, live: env.liveEnabled ? live.pipeline.feedState(Date.now()) : null, replays: replays.size }));

// ---- Live -------------------------------------------------------------------

app.get('/api/live/stream', (req, reply) => {
  let unsubscribe = () => {};
  const send = openSse(reply, () => unsubscribe());
  if (!env.liveEnabled) {
    send('disabled', { message: 'Live mode is turned off on this server (AEROTRACK_LIVE=false).' });
    return;
  }
  send('snapshot', live.snapshot());
  unsubscribe = live.subscribe((s) => send('snapshot', s));
});

app.get<{ Params: { id: string } }>('/api/live/session/:id', async (req, reply) => {
  const d = live.pipeline.detail(req.params.id, Date.now());
  if (!d) return reply.code(404).send({ error: 'Session not found' });
  return d;
});

// ---- Planned routes (static route data, may be outdated) ----------------------

app.get<{ Params: { callsign: string }; Querystring: { lat?: string; lon?: string } }>('/api/route/:callsign', async (req) => {
  const lat = req.query.lat ? Number(req.query.lat) : undefined;
  const lon = req.query.lon ? Number(req.query.lon) : undefined;
  const route = await routes.lookup(req.params.callsign, lat, lon);
  const plausible = route && lat !== undefined && lon !== undefined ? routePlausible(route, lat, lon) : route !== null;
  return { route, plausible };
});

// ---- Recorded ---------------------------------------------------------------

app.get('/api/recordings', async () => listRecordings());

app.get<{ Params: { recId: string }; Querystring: { speed?: string; t?: string } }>('/api/replay/:recId/stream', (req, reply) => {
  const rec = getRecording(req.params.recId);
  if (!rec) {
    reply.code(404).send({ error: 'Recording not found' });
    return;
  }
  let replay: Replay | null = null;
  const send = openSse(reply, () => {
    if (replay) {
      replay.dispose();
      replays.delete(replay.id);
    }
  });
  replay = new Replay(rec.info, rec.polls, coverage, (snapshot, state) => send('snapshot', { ...snapshot, replay: state }), {
    speed: req.query.speed ? Number(req.query.speed) : undefined,
    startTs: req.query.t ? Number(req.query.t) : undefined,
  });
  replays.set(replay.id, replay);
  send('replay', { recording: rec.info, state: replay.state() });
  replay.start();
});

app.post<{ Params: { replayId: string }; Body: { action: string; value?: number } }>('/api/replay/:replayId/control', async (req, reply) => {
  const r = replays.get(req.params.replayId);
  if (!r) return reply.code(404).send({ error: 'Replay not found' });
  r.control(req.body.action, req.body.value);
  return r.state();
});

app.get<{ Params: { replayId: string; id: string } }>('/api/replay/:replayId/session/:id', async (req, reply) => {
  const r = replays.get(req.params.replayId);
  const d = r?.detail(req.params.id);
  if (!d) return reply.code(404).send({ error: 'Session not found' });
  return d;
});

// ---- Built web app (npm start / offline demo) --------------------------------

if (existsSync(env.webDist)) {
  await app.register(fastifyStatic, { root: env.webDist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
}

if (env.liveEnabled) live.start();
await app.listen({ port: env.port, host: env.host });
console.log(`[aerotrack] server on http://${env.host}:${env.port} — live: ${env.liveEnabled ? `${env.provider.label}, ${env.radiusNm} nm around ${env.lat},${env.lon}` : 'off'}`);
