import { create } from 'zustand';
import type { AircraftClass, FlightRoute, SessionDetail } from '@aerotrack/core';
import type { AircraftPhoto, AppConfig, Mode, RecordingInfo, ReplayState, StreamSnapshot } from './api';

export type Connection = 'idle' | 'connecting' | 'open' | 'error' | 'disabled';

export interface Filters {
  /** ICAO airline prefixes; empty = all airlines. */
  airlines: string[];
  classes: AircraftClass[];
  showCoverage: boolean;
}

interface State {
  config: AppConfig | null;
  mode: Mode;
  recordings: RecordingInfo[];
  recordingId: string | null;
  recording: RecordingInfo | null;
  snapshot: StreamSnapshot | null;
  replay: ReplayState | null;
  connection: Connection;
  connectionMessage: string | null;
  /** Bumped to force a stream reconnect. */
  streamNonce: number;
  selectedId: string | null;
  /** Select the aircraft with this hex when it appears (replay highlights). */
  pendingHex: string | null;
  detail: SessionDetail | null;
  /** Planned route of the selected flight (static route data, may be outdated). */
  route: { callsign: string; route: FlightRoute | null; plausible: boolean } | null;
  /** Photo of the selected aircraft (by hex); photo null = none available. */
  photo: { hex: string; photo: AircraftPhoto | null } | null;
  filters: Filters;
  bounds: [number, number, number, number] | null;
  offlineBasemap: boolean;
  /** Pan the map here (bumped on list/search selection). */
  focus: { lon: number; lat: number; zoom?: number; n: number } | null;

  setMode(mode: Mode): void;
  setRecording(id: string | null): void;
  select(id: string | null): void;
  set(partial: Partial<State>): void;
  setFilters(partial: Partial<Filters>): void;
  reconnect(): void;
}

export const useStore = create<State>((set) => ({
  config: null,
  mode: 'live',
  recordings: [],
  recordingId: null,
  recording: null,
  snapshot: null,
  replay: null,
  connection: 'idle',
  connectionMessage: null,
  streamNonce: 0,
  selectedId: null,
  pendingHex: null,
  detail: null,
  route: null,
  photo: null,
  filters: { airlines: [], classes: ['passenger'], showCoverage: false },
  bounds: null,
  offlineBasemap: false,
  focus: null,

  // Hard mode switch: live and recorded data are never shown together.
  setMode: (mode) =>
    set((s) => (s.mode === mode ? s : { mode, snapshot: null, replay: null, selectedId: null, detail: null, route: null, pendingHex: null, connection: 'idle', connectionMessage: null })),
  setRecording: (recordingId) => set({ recordingId, recording: null, snapshot: null, replay: null, selectedId: null, detail: null, route: null, pendingHex: null }),
  select: (selectedId) => set({ selectedId, detail: null, route: null }),
  set: (partial) => set(partial),
  setFilters: (partial) => set((s) => ({ filters: { ...s.filters, ...partial } })),
  reconnect: () => set((s) => ({ streamNonce: s.streamNonce + 1, snapshot: null, replay: null, selectedId: null, detail: null, route: null })),
}));
