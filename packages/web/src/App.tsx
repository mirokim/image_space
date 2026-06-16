import { useEffect } from 'react';
import { useStore } from './store.js';
import { Sidebar } from './components/Sidebar.js';
import { SpaceMap } from './components/SpaceMap.js';
import { ParallelCoords } from './components/ParallelCoords.js';
import { RadarGlyphs } from './components/RadarGlyphs.js';

export function App() {
  const init = useStore((s) => s.init);
  const mode = useStore((s) => s.mode);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <Sidebar />
      {mode === 'pcoord' ? <ParallelCoords /> : mode === 'radar' ? <RadarGlyphs /> : <SpaceMap />}
    </div>
  );
}
