import { postJSON, type RecordingInfo } from '../api';
import { fmtDate, fmtTimeSec, zoneName } from '../format';
import { useStore } from '../store';

/** Picker labels for demo examples, by the pattern they show. */
const PATTERN_LABEL: Record<string, string> = {
  GO_AROUND: 'Go-around',
  POSSIBLE_CIRCLING: 'Holding',
  RAPID_DESCENT: 'Rapid descent',
  SQUAWK_7700: 'Emergency 7700',
  SQUAWK_7600: 'Radio failure 7600',
};

const optionLabel = (r: RecordingInfo) => `${r.expectedInsight ? `${PATTERN_LABEL[r.expectedInsight] ?? r.expectedInsight} · ` : ''}${r.title} (${fmtDate(r.startTs)})`;

export function ReplayBar() {
  const recordings = useStore((s) => s.recordings);
  const recordingId = useStore((s) => s.recordingId);
  const recording = useStore((s) => s.recording);
  const replay = useStore((s) => s.replay);
  const config = useStore((s) => s.config);
  const setRecording = useStore((s) => s.setRecording);
  const set = useStore((s) => s.set);

  if (!recordings.length) {
    return (
      <div className="replaybar">
        <span className="muted">No recordings yet. Capture one with <code>npm run record</code> or import a past flight with <code>npm run import:trace</code>.</span>
      </div>
    );
  }

  const control = (action: string, value?: number) => {
    if (replay) void postJSON(`/api/replay/${replay.replayId}/control`, { action, value }).catch(() => {});
  };

  return (
    <div className="replaybar">
      <select className="rec-select" value={recordingId ?? ''} onChange={(e) => setRecording(e.target.value)} aria-label="Recording">
        {[
          ['Example flights', recordings.filter((r) => r.expectedInsight)],
          ['Captures', recordings.filter((r) => !r.expectedInsight)],
        ].map(([group, list]) =>
          (list as RecordingInfo[]).length ? (
            <optgroup key={group as string} label={group as string}>
              {(list as RecordingInfo[]).map((r) => (
                <option key={r.id} value={r.id}>
                  {optionLabel(r)}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
      {replay && (
        <>
          <button className="icon-btn" onClick={() => control(replay.playing ? 'pause' : 'play')} aria-label={replay.playing ? 'Pause' : 'Play'}>
            {replay.playing ? (
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <span className="scrubber-wrap">
            <input
              className="scrubber"
              type="range"
              min={replay.startTs}
              max={replay.endTs}
              step={1000}
              value={replay.t}
              onChange={(e) => control('seek', Number(e.target.value))}
              aria-label="Replay position"
            />
            {recording?.focus && replay.endTs > replay.startTs && (
              <span
                className="scrubber-mark"
                style={{ left: `${((recording.focus.ts - replay.startTs) / (replay.endTs - replay.startTs)) * 100}%` }}
                title="The pattern shows here"
              />
            )}
          </span>
          <span className="replay-time">
            {fmtTimeSec(replay.t)} <small>{zoneName(replay.t)}</small>
          </span>
          <select className="speed" value={replay.speed} onChange={(e) => control('speed', Number(e.target.value))} aria-label="Replay speed">
            {(config?.speeds ?? [1, 2, 4, 8, 16, 32, 60]).map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </>
      )}
      {recording?.focus && (
        <button
          className="chip"
          onClick={() => {
            control('seek', recording.focus!.ts);
            control('pause');
            set({ pendingHex: recording.focus!.hex });
          }}
        >
          ↳ Jump to event
        </button>
      )}
      {recording?.highlights?.length ? (
        <div className="highlights">
          {recording.highlights.map((h) => (
            <button
              key={h.label}
              className="chip"
              onClick={() => {
                control('seek', h.ts);
                if (h.hex) set({ pendingHex: h.hex });
              }}
            >
              ↳ {h.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
