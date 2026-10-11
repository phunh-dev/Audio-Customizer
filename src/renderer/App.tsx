import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useActiveTab, useAppStore } from './store';
import { startEngine } from './store/engine';
import { getApi } from './api';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { TitleBar } from './components/shell/TitleBar';
import { Toolbar } from './components/shell/Toolbar';
import { TrackList } from './components/tracks/TrackList';
import { TrackInspector } from './components/tracks/TrackInspector';
import { EditorView } from './components/editor/EditorView';
import { TransportBar } from './components/transport/TransportBar';
import { DropOverlay, DropZone, useWindowDrop } from './components/import/DropZone';
import { Toasts } from './components/feedback/Toasts';
import { EffectsPanel } from './features/effects/EffectsPanel';

/** Apply theme + language attributes to <html>. */
export function useDocumentSettings(): void {
  const theme = useAppStore((s) => s.settings.theme);
  const language = useAppStore((s) => s.settings.language);
  const { i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = language;
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);
}

function CenterArea() {
  const { t } = useTranslation();
  const tab = useActiveTab();
  if (tab.loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-muted" role="status">
        <Loader2 className="size-6 animate-ac-spin text-accent" aria-hidden />
        <span className="text-sm">{t('app.tabs.waking')}</span>
      </div>
    );
  }
  if (tab.project.tracks.length === 0) return <DropZone />;
  return <EditorView />;
}

export interface AppProps {
  /** start render loop / sleep monitor / transport binding (disabled in some tests) */
  engine?: boolean;
}

export function App({ engine = true }: AppProps) {
  useDocumentSettings();
  useKeyboardShortcuts();
  const dragging = useWindowDrop();
  useEffect(() => (engine ? startEngine(useAppStore, getApi) : undefined), [engine]);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <TitleBar />
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[272px] shrink-0 flex-col border-r border-border bg-surface 2xl:w-80">
          <TrackList />
        </aside>
        <main className="min-w-0 flex-1 bg-bg">
          <CenterArea />
        </main>
        <aside className="scroll-thin flex w-[376px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface 2xl:w-[420px]">
          <TrackInspector />
          <EffectsPanel />
        </aside>
      </div>
      <TransportBar />
      <Toasts />
      <DropOverlay active={dragging} />
    </div>
  );
}

export default App;
