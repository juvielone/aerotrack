import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { greatCircle, ICON_SCALE, iconClass, type AircraftSummary, type IconClass, type SessionDetail } from '@aerotrack/core';
import { useDrawableRoute, useVisibleAircraft } from '../hooks';
import { MAP_COLOR } from '../format';
import { useStore } from '../store';
import { ICON_SHAPES, iconImage } from './planeIcon';

const ONLINE_STYLE = 'https://tiles.openfreemap.org/styles/dark';

// Fully offline fallback: bundled Natural Earth land outline, no tiles or fonts needed.
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    land: { type: 'geojson', data: '/offline/land.geojson', attribution: 'Offline basemap: Natural Earth' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a1322' } },
    { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#152036' } },
    { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#2b3d5c', 'line-width': 1 } },
  ],
};

const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

async function pickStyle(): Promise<{ style: string | StyleSpecification; offline: boolean }> {
  if (!navigator.onLine) return { style: OFFLINE_STYLE, offline: true };
  try {
    const r = await fetch(ONLINE_STYLE, { signal: AbortSignal.timeout(3500) });
    if (r.ok) return { style: ONLINE_STYLE, offline: false };
  } catch {
    // fall through
  }
  return { style: OFFLINE_STYLE, offline: true };
}

/** Our layers on top of whichever basemap is active. Re-run after every style change. */
function addOverlay(map: MLMap, cfg: { airports: GeoJSON.FeatureCollection; lowCoverage: GeoJSON.FeatureCollection }) {
  // One silhouette per aircraft family, e.g. 'ac-wide', 'ac-turboprop', 'ac-helicopter'.
  for (const cls of Object.keys(ICON_SHAPES) as IconClass[]) {
    if (!map.hasImage(`ac-${cls}`)) map.addImage(`ac-${cls}`, iconImage(cls, 64), { sdf: true, pixelRatio: 2 });
  }
  for (const id of ['coverage', 'airports', 'route-line', 'route-airports', 'track', 'gaps', 'glitches', 'events', 'aircraft']) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty() });
  }
  (map.getSource('airports') as GeoJSONSource).setData(cfg.airports);
  (map.getSource('coverage') as GeoJSONSource).setData(cfg.lowCoverage);

  map.addLayer({ id: 'coverage-fill', type: 'fill', source: 'coverage', layout: { visibility: 'none' }, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'coverage-line', type: 'line', source: 'coverage', layout: { visibility: 'none' }, paint: { 'line-color': '#f59e0b', 'line-opacity': 0.25, 'line-width': 0.5 } });
  map.addLayer({
    id: 'airports',
    type: 'circle',
    source: 'airports',
    paint: { 'circle-radius': 3, 'circle-color': '#0a1322', 'circle-stroke-color': '#7dd3fc', 'circle-stroke-width': 1.5 },
  });
  // Planned route to the destination: dashed, a different colour from the flown track.
  map.addLayer({ id: 'route-line', type: 'line', source: 'route-line', paint: { 'line-color': MAP_COLOR.route, 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } });
  map.addLayer({
    id: 'route-airports',
    type: 'circle',
    source: 'route-airports',
    paint: { 'circle-radius': 7, 'circle-color': 'rgba(167,139,250,0.18)', 'circle-stroke-color': MAP_COLOR.route, 'circle-stroke-width': 2 },
  });
  map.addLayer({ id: 'track-glow', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': MAP_COLOR.track, 'line-width': 8, 'line-opacity': 0.18, 'line-blur': 4 } });
  map.addLayer({ id: 'track', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': MAP_COLOR.track, 'line-width': 2.5 } });
  map.addLayer({ id: 'gaps', type: 'line', source: 'gaps', paint: { 'line-color': MAP_COLOR.gap, 'line-width': 1.5, 'line-dasharray': [2, 3], 'line-opacity': 0.8 } });
  map.addLayer({
    id: 'glitches',
    type: 'circle',
    source: 'glitches',
    paint: { 'circle-radius': 4, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': MAP_COLOR.glitch, 'circle-stroke-width': 1.5 },
  });
  map.addLayer({
    id: 'events',
    type: 'circle',
    source: 'events',
    paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0a1322', 'circle-stroke-width': 2 },
  });
  map.addLayer({
    id: 'aircraft',
    type: 'symbol',
    source: 'aircraft',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': ['get', 'size'],
      'icon-rotate': ['get', 'track'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'z'],
    },
    paint: {
      'icon-color': ['get', 'color'],
      'icon-opacity': ['get', 'opacity'],
      'icon-halo-color': '#0a1322',
      'icon-halo-width': 1.2,
    },
  });
}

function aircraftFeatures(list: AircraftSummary[], selectedId: string | null): GeoJSON.FeatureCollection {
  const order = ['info', 'notice', 'warning', 'alert'] as const;
  const sevColor = (a: AircraftSummary) => {
    if (!a.notable.length) return null;
    const top = a.notable.reduce((acc, n) => (order.indexOf(n.severity) > order.indexOf(acc) ? n.severity : acc), a.notable[0].severity);
    return MAP_COLOR[top];
  };
  return {
    type: 'FeatureCollection',
    features: list.map((a) => {
      const selected = a.sessionId === selectedId;
      const color = selected ? MAP_COLOR.selected : a.signal.stale ? MAP_COLOR.stale : (sevColor(a) ?? MAP_COLOR.aircraft);
      const cls = iconClass(a);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: {
          id: a.sessionId,
          track: a.track ?? 0,
          color,
          icon: `ac-${cls}`,
          size: ICON_SCALE[cls] * (selected ? 1.15 : a.onGround ? 0.6 : 0.85),
          opacity: a.signal.stale ? 0.55 : 1,
          z: selected ? 1000 : a.severityRank * 10 + (a.onGround ? 0 : 1),
        },
      };
    }),
  };
}

function trackFeatures(d: SessionDetail | null) {
  const track = empty();
  const gaps = empty();
  const glitches = empty();
  const events = empty();
  if (!d) return { track, gaps, glitches, events };
  const pts = d.track;
  d.segments.forEach(([a, b], n) => {
    if (b > a) {
      track.features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.slice(a, b + 1).map((p) => [p.lon, p.lat]) } });
    }
    const next = d.segments[n + 1];
    if (next) {
      gaps.features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[pts[b].lon, pts[b].lat], [pts[next[0]].lon, pts[next[0]].lat]] } });
    }
  });
  for (const p of pts) if (p.glitch) glitches.features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
  const nearest = (ts: number) => pts.reduce((best, p) => (Math.abs(p.ts - ts) < Math.abs(best.ts - ts) ? p : best), pts[0]);
  for (const e of d.session.events) {
    if (e.type === 'turn' || e.type === 'climb' || e.type === 'descent' || e.type === 'glitch' || e.type === 'gap' || !pts.length) continue;
    const p = e.evidence.lat !== undefined ? { lat: e.evidence.lat, lon: e.evidence.lon! } : nearest(e.startTs);
    events.features.push({ type: 'Feature', properties: { color: MAP_COLOR[e.severity] }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
  }
  return { track, gaps, glitches, events };
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const labelRef = useRef<maplibregl.Marker | null>(null);
  const airportLabels = useRef<maplibregl.Marker[]>([]);
  const [styleVersion, setStyleVersion] = useState(0);

  const config = useStore((s) => s.config);
  const selectedId = useStore((s) => s.selectedId);
  const detail = useStore((s) => s.detail);
  const showCoverage = useStore((s) => s.filters.showCoverage);
  const recording = useStore((s) => s.recording);
  const mode = useStore((s) => s.mode);
  const focus = useStore((s) => s.focus);
  const offline = useStore((s) => s.offlineBasemap);
  const set = useStore((s) => s.set);
  const select = useStore((s) => s.select);
  const { visible } = useVisibleAircraft();
  const drawn = useDrawableRoute();
  const routeLabels = useRef<maplibregl.Marker[]>([]);

  // Create the map once config is known.
  useEffect(() => {
    if (!config || !el.current || mapRef.current) return;
    let cancelled = false;
    const overlay = {
      airports: {
        type: 'FeatureCollection' as const,
        features: config.airports.map((a) => ({ type: 'Feature' as const, properties: { code: a.code }, geometry: { type: 'Point' as const, coordinates: [a.lon, a.lat] } })),
      },
      lowCoverage: {
        type: 'FeatureCollection' as const,
        features: config.lowCoverage.map((ring) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } })),
      },
    };
    void pickStyle().then(({ style, offline }) => {
      if (cancelled || !el.current) return;
      set({ offlineBasemap: offline });
      const map = new maplibregl.Map({
        container: el.current,
        style,
        center: config.center,
        zoom: window.innerWidth < 760 ? 5.6 : 6.4,
        // Attribution (aircraft data + basemap) is rendered by the app so it can name the active data source.
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      mapRef.current = map;

      map.on('style.load', () => {
        addOverlay(map, overlay);
        setStyleVersion((v) => v + 1);
      });
      // If basemap tiles start failing (venue Wi-Fi), drop to the offline basemap.
      let tileErrors = 0;
      map.on('error', (e) => {
        const src = (e as { sourceId?: string }).sourceId;
        if (src && !['aircraft', 'route-line', 'route-airports', 'track', 'gaps', 'glitches', 'events', 'airports', 'coverage', 'land'].includes(src) && ++tileErrors > 6 && !useStore.getState().offlineBasemap) {
          set({ offlineBasemap: true });
          map.setStyle(OFFLINE_STYLE, { diff: false });
        }
      });
      map.on('click', 'aircraft', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) select(id);
      });
      map.on('click', (e) => {
        if (!map.queryRenderedFeatures(e.point, { layers: ['aircraft'] }).length) select(null);
      });
      map.on('mouseenter', 'aircraft', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'aircraft', () => (map.getCanvas().style.cursor = ''));
      const updateBounds = () => {
        const b = map.getBounds();
        set({ bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
      };
      map.on('moveend', updateBounds);
      map.once('load', updateBounds);
    });
    return () => {
      cancelled = true;
    };
  }, [config, set, select]);

  useEffect(() => () => mapRef.current?.remove(), []);

  // Aircraft positions.
  useEffect(() => {
    const src = mapRef.current?.getSource('aircraft') as GeoJSONSource | undefined;
    src?.setData(aircraftFeatures(visible, selectedId));
  }, [visible, selectedId, styleVersion]);

  // Selected flight: track, gaps, glitches, event markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('track')) return;
    const f = trackFeatures(selectedId && detail?.session.id === selectedId ? detail : null);
    (map.getSource('track') as GeoJSONSource).setData(f.track);
    (map.getSource('gaps') as GeoJSONSource).setData(f.gaps);
    (map.getSource('glitches') as GeoJSONSource).setData(f.glitches);
    (map.getSource('events') as GeoJSONSource).setData(f.events);
  }, [detail, selectedId, styleVersion]);

  // Planned route: dashed great-circle line from the aircraft to its destination, origin and destination ringed.
  const routeKey = drawn ? `${drawn.route.callsign}|${drawn.aircraft.lat}|${drawn.aircraft.lon}` : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('route-line')) return;
    const line = empty();
    const airports = empty();
    routeLabels.current.forEach((m) => m.remove());
    routeLabels.current = [];
    if (drawn) {
      const { route, aircraft } = drawn;
      line.features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: greatCircle(aircraft, route.destination, 48) } });
      for (const [role, ap] of [['From', route.origin], ['To', route.destination]] as const) {
        airports.features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [ap.lon, ap.lat] } });
        const node = document.createElement('div');
        node.className = 'route-label';
        node.textContent = `${role} ${ap.iata ?? ap.icao ?? ''}`;
        routeLabels.current.push(new maplibregl.Marker({ element: node, anchor: 'top', offset: [0, 10] }).setLngLat([ap.lon, ap.lat]).addTo(map));
      }
    }
    (map.getSource('route-line') as GeoJSONSource).setData(line);
    (map.getSource('route-airports') as GeoJSONSource).setData(airports);
  }, [routeKey, styleVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Floating label for the selected aircraft (HTML, so it works without map fonts offline).
  useEffect(() => {
    const map = mapRef.current;
    const a = visible.find((x) => x.sessionId === selectedId);
    if (!map || !a) {
      labelRef.current?.remove();
      labelRef.current = null;
      return;
    }
    if (!labelRef.current) {
      const node = document.createElement('div');
      node.className = 'map-label';
      labelRef.current = new maplibregl.Marker({ element: node, anchor: 'left', offset: [18, 0] }).setLngLat([a.lon, a.lat]).addTo(map);
    }
    labelRef.current.setLngLat([a.lon, a.lat]);
    const node = labelRef.current.getElement();
    const top = a.notable[0];
    node.innerHTML = '';
    const name = document.createElement('strong');
    name.textContent = a.callsign ?? a.hex.toUpperCase();
    const tag = document.createElement('span');
    tag.className = `map-label-tag ${top ? `sev-${top.severity}` : ''}`;
    tag.textContent = top ? labelFor(top.type) : a.status;
    node.append(name, tag);
  }, [visible, selectedId, styleVersion]);

  // Airport code labels on the offline basemap (it has no fonts).
  useEffect(() => {
    const map = mapRef.current;
    airportLabels.current.forEach((m) => m.remove());
    airportLabels.current = [];
    if (!map || !offline || !config) return;
    for (const ap of config.airports) {
      const node = document.createElement('div');
      node.className = 'airport-label';
      node.textContent = ap.code;
      airportLabels.current.push(new maplibregl.Marker({ element: node, anchor: 'top', offset: [0, 4] }).setLngLat([ap.lon, ap.lat]).addTo(map));
    }
  }, [offline, config, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('coverage-fill')) return;
    const v = showCoverage ? 'visible' : 'none';
    map.setLayoutProperty('coverage-fill', 'visibility', v);
    map.setLayoutProperty('coverage-line', 'visibility', v);
  }, [showCoverage, styleVersion]);

  // Frame the recording / live area on mode change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !config) return;
    if (mode === 'recorded' && recording?.center) map.flyTo({ center: recording.center, zoom: recording.zoom ?? 7, duration: 900 });
    else if (mode === 'live') map.flyTo({ center: config.center, zoom: window.innerWidth < 760 ? 5.6 : 6.4, duration: 900 });
  }, [mode, recording?.id, config, styleVersion > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const inView = map.getBounds().contains([focus.lon, focus.lat]);
    if (!inView || focus.zoom) map.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), focus.zoom ?? 0), duration: 700 });
  }, [focus]);

  return <div ref={el} className="map" aria-label="Flight map" />;
}

function labelFor(type: string): string {
  switch (type) {
    case 'holding':
      return 'Circling';
    case 'rapid-descent':
      return 'Rapid descent';
    case 'go-around':
      return 'Go-around';
    case 'go-around-hint':
      return 'Possible go-around';
    case 'squawk-7700':
      return 'Squawk 7700';
    case 'squawk-7600':
      return 'Squawk 7600';
    default:
      return type;
  }
}
