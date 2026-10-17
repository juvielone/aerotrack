import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { airlinesSeen, CLASS_LABEL, type AircraftClass } from '@aerotrack/core';
import { useVisibleAircraft } from '../hooks';
import { useStore } from '../store';

const CLASSES: AircraftClass[] = ['passenger', 'other-powered', 'rotorcraft', 'military', 'non-airliner'];

export function FilterBar() {
  const { all, visible } = useVisibleAircraft();
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const hasCoverage = useStore((s) => (s.config?.lowCoverage.length ?? 0) > 0);
  const airlines = useMemo(() => airlinesSeen(all), [all]);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="filterbar" role="toolbar" aria-label="Filters">
      <Popover label={filters.airlines.length ? `Airlines (${filters.airlines.length})` : 'All airlines'} active={filters.airlines.length > 0}>
        <button className="pop-row" onClick={() => setFilters({ airlines: [] })}>
          <input type="checkbox" readOnly checked={!filters.airlines.length} /> All airlines
        </button>
        {airlines.length === 0 && <p className="muted">No airline callsigns in the current data.</p>}
        {airlines.map((a) => (
          <button key={a.icao} className="pop-row" onClick={() => setFilters({ airlines: toggle(filters.airlines, a.icao) })}>
            <input type="checkbox" readOnly checked={filters.airlines.includes(a.icao)} />
            <span>{a.name}</span>
            <small>{a.count}</small>
          </button>
        ))}
      </Popover>
      <Popover label={filters.classes.length === 1 && filters.classes[0] === 'passenger' ? 'Passenger aircraft' : `Aircraft types (${filters.classes.length})`} active={!(filters.classes.length === 1 && filters.classes[0] === 'passenger')}>
        {CLASSES.map((c) => (
          <button key={c} className="pop-row" onClick={() => setFilters({ classes: toggle(filters.classes, c) })}>
            <input type="checkbox" readOnly checked={filters.classes.includes(c)} />
            <span>{CLASS_LABEL[c]}</span>
          </button>
        ))}
      </Popover>
      {hasCoverage && (
        <button className={`pill ${filters.showCoverage ? 'active' : ''}`} onClick={() => setFilters({ showCoverage: !filters.showCoverage })} aria-pressed={filters.showCoverage}>
          Low-coverage zones
        </button>
      )}
      <span className="count-note">
        {visible.length} of {all.length} aircraft
      </span>
    </div>
  );
}

function Popover({ label, active, children }: { label: string; active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  return (
    <div className="popover" ref={ref}>
      <button className={`pill ${active ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="none" stroke="currentColor" strokeWidth="2" d="M6 15l6-6 6 6" />
        </svg>
      </button>
      {open && <div className="pop-panel">{children}</div>}
    </div>
  );
}
