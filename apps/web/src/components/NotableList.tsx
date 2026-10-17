import { useMemo, useState } from 'react';
import { EVENT_LABEL } from '@aerotrack/core';
import { useVisibleAircraft } from '../hooks';
import { SEVERITY_COLOR } from '../format';
import { useStore } from '../store';

/** Aircraft in the current view with an active event, most severe first. One tap selects. */
export function NotableList() {
  const { visible } = useVisibleAircraft();
  const bounds = useStore((s) => s.bounds);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(() => window.innerWidth >= 760);

  const items = useMemo(() => {
    const inView = (lon: number, lat: number) => !bounds || (lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3]);
    return visible.filter((a) => a.severityRank > 0 && inView(a.lon, a.lat)).sort((a, b) => b.severityRank - a.severityRank || b.lastTs - a.lastTs);
  }, [visible, bounds]);

  return (
    <section className={`notable ${open ? 'open' : ''}`} aria-label="Notable flights">
      <button className="notable-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>Notable flights</span>
        <span className={`count ${items.length ? 'has' : ''}`}>{items.length}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" className="chev" aria-hidden="true">
          <path fill="none" stroke="currentColor" strokeWidth="2" d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="notable-body">
          {!items.length && <p className="muted">Nothing notable in view right now. Holding, rapid descents, emergency codes, go-arounds and unexpected signal loss show up here.</p>}
          {items.map((a) => {
            const top = a.notable[0];
            const label = top ? EVENT_LABEL[top.type] : 'Positions stopped arriving';
            const color = top ? SEVERITY_COLOR[top.severity] : 'var(--sev-notice)';
            return (
              <button
                key={a.sessionId}
                className={`notable-item ${a.sessionId === selectedId ? 'sel' : ''}`}
                onClick={() => {
                  select(a.sessionId);
                  set({ focus: { lon: a.lon, lat: a.lat, n: Date.now() } });
                }}
              >
                <span className="bar" style={{ background: color }} />
                <strong>{a.callsign ?? a.hex.toUpperCase()}</strong>
                <span className="what">{label}</span>
                <span className="st">{a.status}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
