import type { ReactNode } from 'react';
import { useStore } from '../store';

/** Connection / feed / empty states. Never switches mode on its own: it only suggests. */
export function Banner() {
  const mode = useStore((s) => s.mode);
  const connection = useStore((s) => s.connection);
  const message = useStore((s) => s.connectionMessage);
  const feed = useStore((s) => s.snapshot?.feed);
  const count = useStore((s) => s.snapshot?.aircraft.length);
  const recordings = useStore((s) => s.recordings);
  const offline = useStore((s) => s.offlineBasemap);
  const setMode = useStore((s) => s.setMode);
  const setRecording = useStore((s) => s.setRecording);
  const reconnect = useStore((s) => s.reconnect);
  const recordingId = useStore((s) => s.recordingId);

  const goRecorded = () => {
    setMode('recorded');
    if (!recordingId && recordings.length) setRecording(recordings[0].id);
  };

  let body: ReactNode = null;
  let tone = 'info';

  if (connection === 'connecting' || (connection === 'idle' && mode === 'live')) {
    body = <span className="loading">Connecting to {mode === 'live' ? 'the live feed' : 'the recording'}…</span>;
  } else if (connection === 'error' || connection === 'disabled') {
    tone = 'warn';
    body = (
      <>
        <span>{message}</span>
        {mode === 'recorded' && connection === 'error' && <button onClick={reconnect}>Retry</button>}
        {mode === 'live' && recordings.length > 0 && <button onClick={goRecorded}>Switch to recorded</button>}
      </>
    );
  } else if (mode === 'live' && feed?.down) {
    tone = 'warn';
    body = (
      <>
        <span>Live data is temporarily unavailable. This is a problem on our side, not with any aircraft.</span>
        {recordings.length > 0 && <button onClick={goRecorded}>Switch to recorded</button>}
      </>
    );
  } else if (mode === 'recorded' && !recordings.length) {
    body = <span>No recordings available yet.</span>;
  } else if (connection === 'open' && count === 0) {
    body = <span>No aircraft in the data right now.</span>;
  }

  return (
    <>
      {body && (
        <div className={`banner banner-${tone}`} role="status">
          {body}
        </div>
      )}
      {offline && <div className="offline-note">Offline basemap</div>}
    </>
  );
}
