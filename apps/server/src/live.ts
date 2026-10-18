import { CoverageModel, Pipeline, type Snapshot } from '@aerotrack/core';
import { env } from './env';
import { fetchPoll, PROVIDERS, type Provider } from './providers';

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
  /** Failures across all providers since the last success (drives backoff when every feed is down). */
  private failuresSinceSuccess = 0;
  /** The configured provider first, then the others as fallbacks. */
  private readonly providers: Provider[] = [env.provider, ...Object.values(PROVIDERS).filter((p) => p.id !== env.provider.id)];
  private providerIndex = 0;

  /** The provider currently being polled (may differ from the configured one after a failover). */
  get provider(): Provider {
    return this.providers[this.providerIndex];
  }

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
    if (this.failuresSinceSuccess > 3 && Math.random() > (env.pollSeconds / 30)) {
      this.pipeline.ingest({ now: Date.now(), error: 'Live feed unreachable (backing off)' });
      this.emit();
      return;
    }
    this.inFlight = true;
    try {
      const poll = await fetchPoll(this.provider, env.lat, env.lon, env.radiusNm);
      this.consecutiveErrors = 0;
      this.failuresSinceSuccess = 0;
      // Server clock, not provider clock, so staleness is measured consistently against Date.now().
      this.pipeline.ingest({ ...poll, now: Date.now() });
    } catch (err) {
      this.consecutiveErrors++;
      this.failuresSinceSuccess++;
      const msg = err instanceof Error ? (err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message) : String(err);
      if (this.consecutiveErrors <= 3 || this.consecutiveErrors % 10 === 0) console.warn(`[live] ${this.provider.label} poll failed (${this.consecutiveErrors}): ${msg}`);
      this.pipeline.ingest({ now: Date.now(), error: msg });
      // Fail over to the next provider; sticky, so attribution doesn't flip back and forth.
      if (this.consecutiveErrors >= 2 && this.providers.length > 1) {
        const from = this.provider.label;
        this.providerIndex = (this.providerIndex + 1) % this.providers.length;
        this.consecutiveErrors = 0;
        console.warn(`[live] switching provider: ${from} → ${this.provider.label}`);
      }
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
