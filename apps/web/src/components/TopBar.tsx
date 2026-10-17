import { useMemo, useRef, useState } from 'react';
import { airlineName, airlinePrefix, searchFlights, type AircraftSummary } from '@aerotrack/core';
import { fmtDate } from '../format';
import { useStore } from '../store';

export function TopBar() {
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
          <path fill="currentColor" d="M16 4c1 0 1.6 1 1.6 2.2V12l9 5v2.4l-9-2.6v5.6l2.6 2v1.9L16 25.2l-4.2 1.1v-1.9l2.6-2v-5.6l-9 2.6V17l9-5V6.2C14.4 5 15 4 16 4z" />
        </svg>
        <span>Aerotrack</span>
      </div>
      <Search />
      <div className="topbar-right">
        <ModeToggle />
        <DataBadge />
      </div>
    </header>
  );
}

function ModeToggle() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const recordings = useStore((s) => s.recordings);
  const recordingId = useStore((s) => s.recordingId);
  const setRecording = useStore((s) => s.setRecording);
  return (
    <div className="segmented" role="radiogroup" aria-label="Data mode">
      <button role="radio" aria-checked={mode === 'live'} className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}>
        Live
      </button>
      <button
        role="radio"
        aria-checked={mode === 'recorded'}
        className={mode === 'recorded' ? 'on' : ''}
        onClick={() => {
          setMode('recorded');
          if (!recordingId && recordings.length) setRecording(recordings[0].id);
        }}
      >
        Recorded
      </button>
    </div>
  );
}

/** Always says exactly what the user is looking at: live data, or a dated recording with its source. */
function DataBadge() {
  const mode = useStore((s) => s.mode);
  const config = useStore((s) => s.config);
  const feed = useStore((s) => s.snapshot?.feed);
  const recording = useStore((s) => s.recording);
  const connection = useStore((s) => s.connection);

  if (mode === 'live') {
    const down = connection === 'disabled' || connection === 'error' || feed?.down;
    return (
      <div className={`badge ${down ? 'badge-down' : 'badge-live'}`} title={config ? `Data: ${config.live.source}` : undefined}>
        <span className="dot" />
        <span>LIVE</span>
        <span className="badge-sub">{down ? 'feed unavailable' : config ? `Data: ${config.live.source}` : '…'}</span>
      </div>
    );
  }
  if (!recording) return <div className="badge badge-rec">RECORDED</div>;
  if (recording.kind === 'synthetic') return <div className="badge badge-synth">Synthetic test case</div>;
  return (
    <div className="badge badge-rec" title={recording.title}>
      <span>RECORDED</span>
      <span className="badge-sub">
        {fmtDate(recording.startTs)} — Data: {recording.source}
      </span>
    </div>
  );
}

function Search() {
  const aircraft = useStore((s) => s.snapshot?.aircraft);
  const select = useStore((s) => s.select);
  const set = useStore((s) => s.set);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const result = useMemo(() => searchFlights(q, aircraft ?? []), [q, aircraft]);

  const choose = (a: AircraftSummary) => {
    select(a.sessionId);
    set({ focus: { lon: a.lon, lat: a.lat, n: Date.now() } });
    setOpen(false);
    setQ('');
    input.current?.blur();
  };

  const list = result.exact.length ? result.exact : result.suggestions;
  return (
    <div className="search">
      <svg className="search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="none" stroke="currentColor" strokeWidth="2" d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zm5.3-2.2L21 21" />
      </svg>
      <input
        ref={input}
        value={q}
        placeholder="Flight number, callsign or rego (e.g. QF1)"
        aria-label="Search flights"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && result.exact[0]) choose(result.exact[0]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim() && (
        <div className="search-results" role="listbox">
          {!result.exact.length && (
            <div className="search-note">{result.suggestions.length ? 'No exact match — did you mean…' : 'No matching flight in the current data.'}</div>
          )}
          {list.map((a) => {
            const p = airlinePrefix(a.callsign);
            return (
              <button key={a.sessionId} role="option" aria-selected="false" className="search-item" onMouseDown={() => choose(a)}>
                <strong>{a.callsign ?? a.hex.toUpperCase()}</strong>
                <span>{[p && airlineName(p), a.type, a.reg].filter(Boolean).join(' · ')}</span>
                <em>{a.status}</em>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
