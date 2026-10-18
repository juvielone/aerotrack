import { useState } from 'react';
import {
  AIRPORTS,
  EVENT_LABEL,
  INSUFFICIENT_HISTORY,
  airlineName,
  airlinePrefix,
  analyseFlight,
  distanceKm,
  evidenceLine,
  routePlausible,
  selectInsight,
  type AircraftSummary,
  type FlightEvent,
  type FlightInsight,
  type SessionDetail,
  type Severity,
} from '@aerotrack/core';
import { fmtDeg, fmtDuration, fmtFpm, fmtFt, fmtKt, fmtTime, SEVERITY_COLOR, STATUS_TONE } from '../format';
import { useStore } from '../store';
import { AltitudeChart } from './AltitudeChart';

export function FlightPanel() {
  const selectedId = useStore((s) => s.selectedId);
  const detail = useStore((s) => s.detail);
  const a = useStore((s) => s.snapshot?.aircraft.find((x) => x.sessionId === s.selectedId));
  const now = useStore((s) => s.snapshot?.now ?? Date.now());
  const mode = useStore((s) => s.mode);
  const recording = useStore((s) => s.recording);
  const config = useStore((s) => s.config);
  const select = useStore((s) => s.select);

  if (!selectedId) return null;
  const d = detail?.session.id === selectedId ? detail : null;
  const callsign = a?.callsign ?? d?.session.callsign ?? null;
  const prefix = airlinePrefix(callsign);
  const airline = prefix ? airlineName(prefix) : null;
  const status = a?.status ?? d?.status ?? 'Unknown';
  const source = mode === 'live' ? config?.live.source : recording?.source;

  return (
    <aside className="panel" aria-label="Selected flight">
      <div className="panel-head">
        <div>
          <h2>
            {callsign ?? (a?.hex ?? d?.session.hex ?? '').toUpperCase()}
            {airline && <span className="airline"> · {airline}</span>}
          </h2>
          <p className="sub">{[a?.type ?? d?.session.type, a?.reg ?? d?.session.reg, `hex ${(a?.hex ?? d?.session.hex ?? '').toUpperCase()}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="panel-head-right">
          <span className={`status status-${STATUS_TONE[status]}`}>{status}</span>
          <button className="icon-btn close" onClick={() => select(null)} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18"><path stroke="currentColor" strokeWidth="2" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>

      <div className="panel-body">
        <RouteRow />

        {d ? <Insight detail={d} a={a} now={now} /> : <div className="insight skeleton">Loading flight history…</div>}

        {mode === 'recorded' && recording?.reportedCause && (
          <div className="reported">
            <strong>Later reported as…</strong>
            <p>{recording.reportedCause}</p>
            {recording.sourceLink && (
              <a href={recording.sourceLink} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            )}
            <small>Reported separately; not inferred from the tracking data.</small>
          </div>
        )}

        <div className="stats">
          <Stat label="Altitude" value={a?.onGround ? 'Ground' : fmtFt(a?.alt)} />
          <Stat label="Speed" value={fmtKt(a?.gs)} />
          <Stat label="Track" value={fmtDeg(a?.track)} />
          <Stat label="Vertical" value={a?.onGround ? '—' : fmtFpm(a?.baroRate)} />
        </div>

        {d && <AltitudeChart detail={d} />}
        {d && <Timeline events={d.session.events} />}

        <footer className="panel-foot">
          {d && d.track.length > 0 && (
            <span>
              {d.track.length} positions since {fmtTime(d.track[0].ts)}
            </span>
          )}
          <span>Data: {source ?? '—'}</span>
          <span className="disclaimer">Informational only. Not a safety, navigation or emergency-detection system.</span>
        </footer>
      </div>
    </aside>
  );
}

/** Planned origin → destination from static route data. Always labelled as possibly outdated. */
function RouteRow() {
  const route = useStore((s) => s.route);
  const a = useStore((s) => s.snapshot?.aircraft.find((x) => x.sessionId === s.selectedId));
  if (!route?.route || !a || a.callsign !== route.callsign) return null;
  const r = route.route;
  const code = (ap: typeof r.origin) => ap.iata ?? ap.icao ?? '?';
  if (!routePlausible(r, a.lat, a.lon)) {
    return (
      <div className="route-row route-mismatch">
        <p>
          Route data for {r.callsign} ({code(r.origin)} → {code(r.destination)}) doesn’t match this aircraft’s position, so it isn’t shown.
        </p>
      </div>
    );
  }
  return (
    <div className="route-row">
      <div className="route-codes">
        <strong>{code(r.origin)}</strong>
        <span className="route-arrow" aria-hidden="true" />
        <strong>{code(r.destination)}</strong>
      </div>
      <div className="route-names">
        <span>{r.origin.name}</span>
        <span>{r.destination.name}</span>
      </div>
      <small>Planned route — may be outdated · Source: {r.source}</small>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const SIGNAL_TONE: Record<string, Severity> = { feed: 'warning', unexpected: 'notice', coverage: 'info' };

/**
 * The most relevant thing the data shows right now, with its evidence one tap away. Shows the highest-priority
 * active or recent insight at snapshot time (replay time in recorded mode), otherwise the default status text.
 */
function Insight({ detail, a, now }: { detail: SessionDetail; a: AircraftSummary | undefined; now: number }) {
  const [why, setWhy] = useState(false);
  const events = detail.session.events;
  // Recomputed against the latest snapshot time; the detail itself may be up to a second old.
  const sel = selectInsight(analyseFlight({ events, signal: a?.signal ?? detail.signal }, now), now);

  if (!sel) {
    const text = detail.insufficientHistory ? INSUFFICIENT_HISTORY : describeStatus(detail, a);
    return (
      <section className="insight insight-info">
        <header>
          <span className="insight-kicker">Aerotrack insight</span>
        </header>
        <h3>What the data shows</h3>
        <p>{text}</p>
      </section>
    );
  }

  const ins = sel.primary;
  const source = ins.eventId ? events.find((e) => e.id === ins.eventId) : undefined;
  const tone = source?.severity ?? SIGNAL_TONE[(a?.signal ?? detail.signal).cause ?? ''] ?? 'info';
  const evidence = evidenceLine(ins.evidence);
  return (
    <section className={`insight insight-${tone}`}>
      <header>
        <span className="insight-kicker">
          Aerotrack insight
          {ins.status === 'recent' && <span className="insight-recent">Recent</span>}
        </span>
        {source && (
          <button className="link" onClick={() => setWhy((w) => !w)} aria-expanded={why}>
            {why ? 'Hide evidence' : 'Why am I seeing this?'}
          </button>
        )}
      </header>
      <h3>{ins.title}</h3>
      <p>{ins.observed}</p>
      <p className="insight-explain">{ins.explanation}</p>
      {ins.limitations && <p className="insight-limits">{ins.limitations}</p>}
      {(evidence || sel.moreCount > 0) && (
        <div className="insight-foot">
          {evidence && <span className="insight-evidence">{evidence}</span>}
          {sel.moreCount > 0 && (
            <button className="link" onClick={() => document.getElementById('event-timeline')?.scrollIntoView({ behavior: 'smooth' })}>
              +{sel.moreCount} more
            </button>
          )}
        </div>
      )}
      {source && why && <Evidence e={source} />}
    </section>
  );
}

function describeStatus(d: SessionDetail, a: AircraftSummary | undefined): string {
  const last = d.track[d.track.length - 1];
  const alt = a?.alt ?? last?.alt;
  switch (d.status) {
    case 'Landed': {
      const ap = last && AIRPORTS.find((x) => distanceKm(x.lat, x.lon, last.lat, last.lon) < 6);
      return ap ? `This flight has landed at ${ap.name} (${ap.code}).` : 'This flight has landed.';
    }
    case 'Cruising':
      return `Flying level at ${fmtFt(alt)}. Nothing unusual in the data.`;
    case 'Taxiing':
      return `Moving on the ground at ${fmtKt(a?.gs ?? last?.gs)}.`;
    case 'On ground':
      return 'Stationary on the ground.';
    case 'Taking off':
      return 'Taking off: it has just left the ground or is accelerating along the runway.';
    case 'Climbing':
      return `Climbing through ${fmtFt(alt)}.`;
    case 'Descending':
      return `Descending through ${fmtFt(alt)}.`;
    case 'Approach':
      return `Descending through ${fmtFt(alt)} near an airport, consistent with an approach. The data doesn't confirm where it will land.`;
    case 'Airborne':
      return `Flying at ${fmtFt(alt)}.`;
    default:
      return 'Not enough recent data to describe this flight.';
  }
}

function Evidence({ e }: { e: FlightEvent }) {
  const ev = e.evidence;
  const rows: [string, string][] = [['Window', `${fmtTime(ev.startTs)} – ${fmtTime(ev.endTs)} (${fmtDuration((ev.endTs - ev.startTs) / 1000)})`]];
  if (ev.startAlt !== undefined || ev.endAlt !== undefined) rows.push(['Altitude', `${fmtFt(ev.startAlt)} → ${fmtFt(ev.endAlt)}`]);
  if (ev.rateFpm !== undefined) rows.push(['Average rate', fmtFpm(ev.rateFpm)]);
  if (ev.degrees !== undefined) rows.push(['Track change', `${ev.degrees}° ${ev.direction ?? ''}`]);
  if (ev.lowestAlt !== undefined) rows.push(['Lowest point', fmtFt(ev.lowestAlt)]);
  if (ev.airport) rows.push(['Near airport', ev.airport]);
  if (ev.squawk) rows.push(['Squawk', ev.squawk]);
  if (ev.rejectedAlt !== undefined) rows.push(['Rejected reading', fmtFt(ev.rejectedAlt)]);
  if (ev.gapCause) rows.push(['Likely reason', ev.gapCause === 'feed' ? 'Our feed was down' : ev.gapCause === 'coverage' ? 'Known low-coverage area' : 'Unknown']);
  if (ev.obsCount !== undefined) rows.push(['Observations', String(ev.obsCount)]);
  return (
    <dl className="evidence">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Timeline({ events }: { events: FlightEvent[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showRoutine, setShowRoutine] = useState(false);
  const routine = (e: FlightEvent) => e.type === 'turn' || e.type === 'glitch';
  const list = [...events].reverse().filter((e) => showRoutine || !routine(e));
  const hidden = events.filter(routine).length;
  return (
    <section className="timeline" id="event-timeline">
      <header>
        <h3>Event timeline</h3>
        {hidden > 0 && (
          <button className="link" onClick={() => setShowRoutine((s) => !s)}>
            {showRoutine ? 'Hide turns & readings' : `Show ${hidden} turns & readings`}
          </button>
        )}
      </header>
      {!list.length && <p className="muted">No events detected in this flight’s data yet.</p>}
      <ol>
        {list.slice(0, 40).map((e) => (
          <li key={e.id}>
            <button className="tl-item" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
              <time>{fmtTime(e.startTs)}</time>
              <span className="tl-dot" style={{ background: SEVERITY_COLOR[e.severity] }} />
              <span className="tl-text">
                <strong>
                  {EVENT_LABEL[e.type]}
                  {e.ongoing ? <em> · now</em> : e.endTs > e.startTs && <em className="tl-ended"> · ended {fmtTime(e.endTs)}</em>}
                </strong>
                <span>{e.text}</span>
              </span>
            </button>
            {open === e.id && <Evidence e={e} />}
          </li>
        ))}
      </ol>
    </section>
  );
}
