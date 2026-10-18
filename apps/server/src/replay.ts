import { randomUUID } from 'node:crypto';
import { CoverageModel, Pipeline, type RawPoll, type Snapshot } from '@aerotrack/core';
import type { RecordingInfo } from './recordings';

export interface ReplayState {
  replayId: string;
  recordingId: string;
  t: number;
  startTs: number;
  endTs: number;
  speed: number;
  playing: boolean;
  ended: boolean;
}

type Listener = (snap: Snapshot, state: ReplayState) => void;

const TICK_MS = 250;
export const SPEEDS = [1, 2, 4, 8, 16, 32, 60];

/**
 * Replays a recording through a fresh pipeline (the same code path as live), one instance per viewer.
 * Simulated time drives staleness, so gaps and signal-lost look exactly as they did at the time.
 */
export class Replay {
  readonly id = randomUUID();
  private pipeline!: Pipeline;
  private cursor = 0;
  private t: number;
  private speed: number;
  private playing = true;
  /** The replay pauses once when it first reaches the recording's focus moment, so the presenter can explain it. */
  private pausedAtFocus = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly info: RecordingInfo,
    private polls: RawPoll[],
    private coverage: CoverageModel,
    private listener: Listener,
    opts: { speed?: number; startTs?: number } = {},
  ) {
    this.speed = opts.speed ?? info.speed ?? 8;
    this.t = info.startTs;
    this.reset();
    if (opts.startTs) this.advanceTo(opts.startTs);
    else this.advanceTo(info.startTs);
  }

  start(): void {
    this.emit();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }

  state(): ReplayState {
    return {
      replayId: this.id,
      recordingId: this.info.id,
      t: this.t,
      startTs: this.info.startTs,
      endTs: this.info.endTs,
      speed: this.speed,
      playing: this.playing,
      ended: this.t >= this.info.endTs,
    };
  }

  detail(sessionId: string) {
    return this.pipeline.detail(sessionId, this.t);
  }

  control(action: string, value?: number): void {
    if (action === 'play') {
      if (this.t >= this.info.endTs) this.seek(this.info.startTs);
      this.playing = true;
    } else if (action === 'pause') this.playing = false;
    else if (action === 'speed' && value && value > 0) this.speed = Math.min(value, 120);
    else if (action === 'seek' && value !== undefined) this.seek(value);
    this.emit();
  }

  private reset(): void {
    this.pipeline = new Pipeline({ mode: 'recorded', coverage: this.coverage, staleSec: this.info.staleSec });
    this.cursor = 0;
    this.t = this.info.startTs;
  }

  private seek(ts: number): void {
    const target = Math.max(this.info.startTs, Math.min(ts, this.info.endTs));
    if (target < this.t) this.reset();
    this.advanceTo(target);
  }

  private advanceTo(ts: number): void {
    while (this.cursor < this.polls.length && this.polls[this.cursor].now <= ts) {
      this.pipeline.ingest(this.polls[this.cursor]);
      this.cursor++;
    }
    this.t = ts;
  }

  private tick(): void {
    if (!this.playing) return;
    let next = Math.min(this.t + TICK_MS * this.speed, this.info.endTs);
    const focus = this.info.focus?.ts;
    const reachesFocus = focus !== undefined && !this.pausedAtFocus && this.t < focus && next >= focus;
    if (reachesFocus) next = focus;
    this.advanceTo(next);
    if (reachesFocus) {
      this.pausedAtFocus = true;
      this.playing = false;
    }
    if (next >= this.info.endTs) this.playing = false;
    this.emit();
  }

  private emit(): void {
    this.listener(this.pipeline.snapshot(this.t), this.state());
  }
}
