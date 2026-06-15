import { useEffect } from 'react';
import { useStore } from './store.js';
import { Sidebar } from './components/Sidebar.js';
import { SpaceMap } from './components/SpaceMap.js';

export function App() {
  const init = useStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <Sidebar />
      <SpaceMap />
    </div>
  );
}
