import { useEffect, useMemo, useRef } from 'react';
import { aircraftClass, airlinePrefix, routePlausible, type AircraftSummary, type FlightRoute, type SessionDetail } from '@aerotrack/core';
import { getJSON, sessionUrl, type AircraftPhoto, type AppConfig, type RecordingInfo, type ReplayState, type StreamSnapshot } from './api';
import { useStore } from './store';

/** Loads server config and the recordings list once. */
export function useBootstrap() {
  const set = useStore((s) => s.set);
  useEffect(() => {
    getJSON<AppConfig>('/api/config')
      .then((config) => set({ config }))
      .catch(() => set({ connection: 'error', connectionMessage: 'Can’t reach the Aerotrack server. Is it running (npm run dev)?' }));
    getJSON<RecordingInfo[]>('/api/recordings')
      .then((recordings) => set({ recordings }))
      .catch(() => {});
  }, [set]);
}

/** Opens exactly one event stream for the current mode; switching mode tears it down first. */
export function useStream() {
  const mode = useStore((s) => s.mode);
  const recordingId = useStore((s) => s.recordingId);
  const nonce = useStore((s) => s.streamNonce);
  const set = useStore((s) => s.set);

  useEffect(() => {
    const url = mode === 'live' ? '/api/live/stream' : recordingId ? `/api/replay/${encodeURIComponent(recordingId)}/stream` : null;
    if (!url) {
      set({ connection: 'idle' });
      return;
    }
    set({ connection: 'connecting', connectionMessage: null });
    const es = new EventSource(url);
    let closed = false;

    es.addEventListener('snapshot', (e) => {
      const snap = JSON.parse((e as MessageEvent).data) as StreamSnapshot;
      const s = useStore.getState();
      const patch: Partial<ReturnType<typeof useStore.getState>> = { snapshot: snap, connection: 'open', connectionMessage: null };
      if (snap.replay) patch.replay = snap.replay;
      // A highlight asked to select an aircraft: pick its current session once it appears.
      if (s.pendingHex) {
        const a = snap.aircraft.find((x) => x.hex === s.pendingHex);
        if (a) Object.assign(patch, { selectedId: a.sessionId, pendingHex: null, detail: null });
      }
      set(patch);
    });
    es.addEventListener('replay', (e) => {
      const { recording, state } = JSON.parse((e as MessageEvent).data) as { recording: RecordingInfo; state: ReplayState };
      // Demo examples open with their aircraft selected, so the Insights panel and timeline are already showing.
      set({ recording, replay: state, ...(recording.focus && { pendingHex: recording.focus.hex }) });
    });
    es.addEventListener('disabled', (e) => {
      const { message } = JSON.parse((e as MessageEvent).data);
      set({ connection: 'disabled', connectionMessage: message });
      es.close();
    });
    es.onerror = () => {
      if (closed) return;
      if (mode === 'recorded') {
        // A replay can't resume mid-way on reconnect; stop and let the user retry.
        es.close();
        set({ connection: 'error', connectionMessage: 'Lost connection to the replay. Press retry to start it again.' });
      } else {
        set({ connection: 'error', connectionMessage: 'Lost connection to the Aerotrack server. Retrying…' });
      }
    };
    return () => {
      closed = true;
      es.close();
    };
  }, [mode, recordingId, nonce, set]);
}

/** Keeps the selected flight's full track and events up to date (at most ~1 request/s). */
export function useSelectedDetail() {
  const selectedId = useStore((s) => s.selectedId);
  const snapshotNow = useStore((s) => s.snapshot?.now);
  const mode = useStore((s) => s.mode);
  const replayId = useStore((s) => s.replay?.replayId);
  const set = useStore((s) => s.set);
  const last = useRef({ id: '', at: 0, inFlight: false });

  useEffect(() => {
    if (!selectedId) return;
    const url = sessionUrl(mode, replayId, selectedId);
    if (!url) return;
    const l = last.current;
    const changed = l.id !== selectedId;
    if (!changed && (l.inFlight || Date.now() - l.at < 1000)) return;
    l.id = selectedId;
    l.at = Date.now();
    l.inFlight = true;
    getJSON<SessionDetail>(url)
      .then((detail) => {
        if (useStore.getState().selectedId === selectedId) set({ detail });
      })
      .catch(() => {
        // The session aged out of memory.
        if (useStore.getState().selectedId === selectedId) set({ selectedId: null, detail: null });
      })
      .finally(() => {
        l.inFlight = false;
      });
  }, [selectedId, snapshotNow, mode, replayId, set]);
}

/** Looks up a photo of the selected aircraft once per hex (Planespotters.net, via our server). */
export function useSelectedPhoto() {
  const hex = useStore((s) => s.snapshot?.aircraft.find((a) => a.sessionId === s.selectedId)?.hex ?? (s.detail?.session.id === s.selectedId ? s.detail?.session.hex : null) ?? null);
  const set = useStore((s) => s.set);
  useEffect(() => {
    if (!hex) return;
    if (useStore.getState().photo?.hex === hex) return;
    set({ photo: null });
    const st = useStore.getState();
    const reg = st.snapshot?.aircraft.find((a) => a.hex === hex)?.reg ?? st.detail?.session.reg;
    let stale = false;
    getJSON<{ photo: AircraftPhoto | null }>(`/api/photo/${encodeURIComponent(hex)}${reg ? `?reg=${encodeURIComponent(reg)}` : ''}`)
      .then((r) => {
        if (!stale) set({ photo: { hex, photo: r.photo } });
      })
      .catch(() => {
        // No photo is fine; the panel simply doesn't show one.
        if (!stale) set({ photo: { hex, photo: null } });
      });
    return () => {
      stale = true;
    };
  }, [hex, set]);
}

/** Looks up the selected flight's planned route once per callsign (not on every snapshot). */
export function useSelectedRoute() {
  const callsign = useStore((s) => s.snapshot?.aircraft.find((a) => a.sessionId === s.selectedId)?.callsign ?? null);
  const set = useStore((s) => s.set);
  useEffect(() => {
    if (!callsign || !airlinePrefix(callsign)) {
      set({ route: null });
      return;
    }
    if (useStore.getState().route?.callsign === callsign) return;
    const a = useStore.getState().snapshot?.aircraft.find((x) => x.callsign === callsign);
    const q = a ? `?lat=${a.lat}&lon=${a.lon}` : '';
    let stale = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A failed request (e.g. server restarting) is retried rather than remembered as "no route".
    const attempt = (n: number) =>
      getJSON<{ route: FlightRoute | null; plausible: boolean }>(`/api/route/${encodeURIComponent(callsign)}${q}`)
        .then((r) => {
          if (!stale) set({ route: { callsign, ...r } });
        })
        .catch(() => {
          if (!stale && n < 4) timer = setTimeout(() => attempt(n + 1), 2000 * (n + 1));
        });
    void attempt(0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [callsign, set]);
}

/** The selected flight's route if it's worth drawing: known, matching the current position, and not yet landed. */
export function useDrawableRoute(): { route: FlightRoute; aircraft: AircraftSummary } | null {
  const route = useStore((s) => s.route);
  const a = useStore((s) => s.snapshot?.aircraft.find((x) => x.sessionId === s.selectedId));
  if (!route?.route || !a || a.callsign !== route.callsign) return null;
  if (a.onGround || a.status === 'Landed' || !routePlausible(route.route, a.lat, a.lon)) return null;
  return { route: route.route, aircraft: a };
}

/** Aircraft passing the current filters. The selected aircraft is always included. */
export function useVisibleAircraft(): { all: AircraftSummary[]; visible: AircraftSummary[] } {
  const aircraft = useStore((s) => s.snapshot?.aircraft);
  const filters = useStore((s) => s.filters);
  const selectedId = useStore((s) => s.selectedId);
  return useMemo(() => {
    const all = aircraft ?? [];
    const visible = all.filter((a) => {
      if (a.sessionId === selectedId) return true;
      if (!filters.classes.includes(aircraftClass(a))) return false;
      if (filters.airlines.length) {
        const p = airlinePrefix(a.callsign);
        if (!p || !filters.airlines.includes(p)) return false;
      }
      return true;
    });
    return { all, visible };
  }, [aircraft, filters, selectedId]);
}
