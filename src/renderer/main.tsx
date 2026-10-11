import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/index.css';
import './i18n';

async function boot(): Promise<void> {
  // In a plain browser (no Electron preload) run against the in-memory mock engine.
  if (!window.api) {
    const { installMockApi } = await import('./testing/mockApi');
    installMockApi({ simulatePlayback: true });
  }
  const { App } = await import('./App');
  const root = document.getElementById('root');
  if (!root) return;
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
