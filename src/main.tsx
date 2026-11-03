import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './ui/styles.css';
import { createRuntime, STORAGE_KEY } from './core';
import { RuntimeProvider } from './ui/runtime';
import { App } from './ui/App';

const root = createRoot(document.getElementById('root')!);
root.render(
  <div className="loading-screen">
    <div className="box">
      <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 9 }} />
      <span>Préparation des données de démonstration…</span>
    </div>
  </div>,
);

createRuntime()
  .then((runtime) => {
    // Keep several tabs (e.g. admin + simulator) in sync.
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) runtime.repo.reloadFromDriver();
    });
    window.addEventListener('beforeunload', () => runtime.repo.flush());
    root.render(
      <RuntimeProvider runtime={runtime}>
        <App />
      </RuntimeProvider>,
    );
  })
  .catch((err) => {
    console.error(err);
    root.render(
      <div className="loading-screen">
        <div className="box">
          <b>Impossible de démarrer le prototype</b>
          <span>{String(err?.message ?? err)}</span>
          <button className="btn" onClick={() => { localStorage.removeItem(STORAGE_KEY); location.reload(); }}>
            Réinitialiser les données
          </button>
        </div>
      </div>,
    );
  });
