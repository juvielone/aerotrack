import { Banner } from './components/Banner';
import { FilterBar } from './components/FilterBar';
import { FlightPanel } from './components/FlightPanel';
import { NotableList } from './components/NotableList';
import { ReplayBar } from './components/ReplayBar';
import { TopBar } from './components/TopBar';
import { useBootstrap, useDrawableRoute, useSelectedDetail, useSelectedRoute, useStream } from './hooks';
import { MapView } from './map/MapView';
import { useStore } from './store';

export function App() {
  useBootstrap();
  useStream();
  useSelectedDetail();
  useSelectedRoute();
  const drawn = useDrawableRoute();
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => s.selectedId !== null);
  const source = useStore((s) => (s.mode === 'live' ? s.config?.live.source : s.recording?.source));
  const offline = useStore((s) => s.offlineBasemap);

  return (
    <div className={`app mode-${mode} ${selected ? 'has-panel' : ''}`}>
      <TopBar />
      <main className="main">
        <div className="map-wrap">
          <MapView />
          <Banner />
          <NotableList />
          <div className="bottom">
            {mode === 'recorded' && <ReplayBar />}
            <FilterBar />
          </div>
          <div className="data-attrib">
            Aircraft data: {source ?? '—'}{drawn ? ` · Routes: ${drawn.route.source}` : ''} · {offline ? 'Map: Natural Earth (offline)' : 'Map © OpenFreeMap · OpenMapTiles · OpenStreetMap contributors'}
          </div>
        </div>
        <FlightPanel />
      </main>
    </div>
  );
}
