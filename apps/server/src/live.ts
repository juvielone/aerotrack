import { CoverageModel, Pipeline, type Snapshot } from '@aerotrack/core';
import { env } from './env';
import { fetchPoll } from './providers';

type Listener = (s: Snapshot) => void;

/**
 * One shared backend poll for all clients (respects provider rate limits; no keys in client code).
 * Keeps rolling per-session history so a selected aircraft already has a track.
 */
export class LiveFeed {
  readonly pipeline: Pipeline;
  private listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private consecutiveErrors = 0;

  constructor(coverage: CoverageModel) {
    this.pipeline = new Pipeline({ mode: 'live', coverage });
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), env.pollSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): Snapshot {
    return this.pipeline.snapshot(Date.now());
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    // Back off politely after repeated failures (max ~1 request / 30 s).
    if (this.consecutiveErrors > 3 && Math.random() > (env.pollSeconds / 30)) {
      this.pipeline.ingest({ now: Date.now(), error: 'Live feed unreachable (backing off)' });
      this.emit();
      return;
    }
    this.inFlight = true;
    try {
      const poll = await fetchPoll(env.provider, env.lat, env.lon, env.radiusNm);
      this.consecutiveErrors = 0;
      // Server clock, not provider clock, so staleness is measured consistently against Date.now().
      this.pipeline.ingest({ ...poll, now: Date.now() });
    } catch (err) {
      this.consecutiveErrors++;
      const msg = err instanceof Error ? (err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message) : String(err);
      if (this.consecutiveErrors <= 3 || this.consecutiveErrors % 10 === 0) console.warn(`[live] poll failed (${this.consecutiveErrors}): ${msg}`);
      this.pipeline.ingest({ now: Date.now(), error: msg });
    } finally {
      this.inFlight = false;
    }
    this.emit();
  }

  private emit(): void {
    if (!this.listeners.size) return;
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }
}
