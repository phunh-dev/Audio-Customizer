/**
 * Bindings between the store and the audio engine:
 * - render loop: debounced re-render of the ACTIVE tab whenever its project,
 *   preview-export settings or wake nonce change (only the active tab renders);
 * - sleep monitor: periodically puts inactive tabs to sleep;
 * - transport: mirrors api.onTransport into the store.
 */
import type { AudioApi } from '@shared/api';
import type { AppStoreHook, Tab } from './appStore';

export const RENDER_DEBOUNCE_MS = 150;
export const SLEEP_CHECK_INTERVAL_MS = 30_000;

export interface RenderConfig {
  peaksBuckets: number;
  spectrogramWidth: number;
  spectrogramHeight: number;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = { peaksBuckets: 4096, spectrogramWidth: 1600, spectrogramHeight: 256 };

interface RenderKey {
  tabId: string;
  project: Tab['project'];
  preview: Tab['previewExport'];
  nonce: number;
  sleeping: boolean;
}

function keyOf(store: AppStoreHook): RenderKey | null {
  const s = store.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab) return null;
  return {
    tabId: tab.id,
    project: tab.project,
    preview: tab.previewExport,
    nonce: tab.renderNonce,
    sleeping: tab.sleeping || tab.loading,
  };
}

function sameKey(a: RenderKey | null, b: RenderKey | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.tabId === b.tabId &&
    a.project === b.project &&
    a.preview === b.preview &&
    a.nonce === b.nonce &&
    a.sleeping === b.sleeping
  );
}

/**
 * Start the debounced render loop. Returns a stop function.
 * A render is requested immediately (after the debounce) for the current state.
 */
export function startRenderLoop(
  store: AppStoreHook,
  getApi: () => AudioApi,
  config: RenderConfig = DEFAULT_RENDER_CONFIG,
  debounceMs = RENDER_DEBOUNCE_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: RenderKey | null = null;
  let seq = 0;
  let stopped = false;
  /** last successfully rendered key per tab (skip re-render when switching back) */
  const rendered = new Map<string, RenderKey>();

  const run = async (key: RenderKey): Promise<void> => {
    const mySeq = ++seq;
    const s = store.getState();
    if (key.project.tracks.length === 0) {
      s.setRenderResult(key.tabId, null);
      return;
    }
    s.setRenderStatus(key.tabId, 'rendering');
    try {
      const result = await getApi().render({
        sessionId: key.tabId,
        project: key.project,
        preview: key.preview,
        peaksBuckets: config.peaksBuckets,
        spectrogramWidth: config.spectrogramWidth,
        spectrogramHeight: config.spectrogramHeight,
      });
      if (stopped || mySeq !== seq) return;
      store.getState().setRenderResult(key.tabId, result);
      rendered.set(key.tabId, key);
    } catch (e) {
      if (stopped || mySeq !== seq) return;
      const msg = e instanceof Error ? e.message : String(e);
      store.getState().setRenderStatus(key.tabId, 'error', msg);
      store.getState().pushError(e);
    }
  };

  const schedule = (): void => {
    const key = keyOf(store);
    if (sameKey(key, last)) return;
    last = key;
    if (timer) clearTimeout(timer);
    timer = null;
    if (!key || key.sleeping) return;
    const tab = store.getState().tabs.find((t) => t.id === key.tabId);
    if (tab?.render && sameKey(rendered.get(key.tabId) ?? null, key)) return;
    timer = setTimeout(() => {
      timer = null;
      void run(key);
    }, debounceMs);
  };

  const unsub = store.subscribe(schedule);
  schedule();
  return () => {
    stopped = true;
    unsub();
    if (timer) clearTimeout(timer);
  };
}

/** Periodically put inactive tabs to sleep. Returns a stop function. */
export function startSleepMonitor(store: AppStoreHook, intervalMs = SLEEP_CHECK_INTERVAL_MS): () => void {
  const id = setInterval(() => {
    void store.getState().checkSleep(Date.now());
  }, intervalMs);
  return () => clearInterval(id);
}

/** Mirror engine transport pushes into the store. Returns an unsubscribe function. */
export function bindTransport(store: AppStoreHook, getApi: () => AudioApi): () => void {
  const api = getApi();
  const off = api.onTransport((s) => store.getState().handleTransport(s));
  void api
    .getTransport()
    .then((s) => store.getState().handleTransport(s))
    .catch(() => undefined);
  return off;
}

/** Start every engine binding (used once by <App />). */
export function startEngine(store: AppStoreHook, getApi: () => AudioApi, config?: RenderConfig): () => void {
  const stops = [startRenderLoop(store, getApi, config), startSleepMonitor(store), bindTransport(store, getApi)];
  return () => stops.forEach((s) => s());
}
