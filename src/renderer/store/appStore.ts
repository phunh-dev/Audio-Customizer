/**
 * Application store (zustand). See `./index.ts` for the documented public API.
 *
 * - Every tab is an independent working session with its own Project,
 *   selection, playhead, viewport, undo/redo history and render result.
 * - Every project mutation goes through `commit()` (immer patches) and is
 *   therefore undoable; view state (selection, zoom, playhead) is not.
 */
import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import {
  createDefaultExportOptions,
  createDefaultProject,
  createDefaultTrack,
  type EffectChain,
  type EffectTarget,
  type ExportOptions,
  type FadeCurve,
  type MasterSettings,
  type Project,
  type Track,
} from '@shared/types';
import {
  errorCodeOf,
  errorDetailOf,
  type AudioApi,
  type ErrorCode,
  type RenderResult,
  type SourceInfo,
  type TransportState,
} from '@shared/api';
import * as hist from './history';
import type { History, ProjectRecipe } from './history';
import {
  arrangeSequential as arrangeTracks,
  projectDuration,
  rippleDelete,
  splitTrack,
  trackEnd,
  trimTrack,
  type SourceDurations,
} from '../utils/edit';
import { clamp, stepPosition, type StepUnit, STEP_UNITS } from '../utils/time';
import { readJson, writeJson } from '../utils/storage';
import type { ColormapName } from '../utils/colormap';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Language = 'en' | 'vi';
export type Theme = 'dark' | 'light';

export interface Settings {
  language: Language;
  theme: Theme;
  /** inactive tabs fall asleep after this many minutes */
  sleepMinutes: number;
  /** snap clip drags to other clip edges / playhead */
  snap: boolean;
  stepUnit: StepUnit;
  colormap: ColormapName;
}

export interface Region {
  start: number;
  end: number;
}

export type RenderStatus = 'idle' | 'rendering' | 'error';

export interface Tab {
  id: string;
  /** user given name, null = default numbered name */
  title: string | null;
  number: number;
  project: Project;
  history: History;
  selectedTrackId: string | null;
  selection: Region | null;
  playhead: number;
  pxPerSec: number;
  scroll: number;
  render: RenderResult | null;
  renderStatus: RenderStatus;
  renderError: string | null;
  /** export settings applied to the preview (null = off) */
  previewExport: ExportOptions | null;
  /** last export settings used in this tab */
  exportOptions: ExportOptions;
  sleeping: boolean;
  loading: boolean;
  lastActive: number;
  /** bumped when the tab must be re-rendered without a project change (wake) */
  renderNonce: number;
  /** the timeline should zoom to fit once content is visible (set on first import) */
  needsFit: boolean;
}

export interface Toast {
  id: string;
  kind: 'error' | 'info';
  /** error code (kind = error) */
  code?: ErrorCode;
  /** i18n key (kind = info) */
  messageKey?: string;
  detail: string;
}

export interface TrackFieldsPatch {
  name?: string;
  offset?: number;
  clipStart?: number;
  clipEnd?: number | null;
  gainDb?: number;
  pan?: number;
  mute?: boolean;
  solo?: boolean;
  fadeIn?: Track['fadeIn'];
  fadeOut?: Track['fadeOut'];
}

export interface AppState {
  tabs: Tab[];
  activeTabId: string;
  sources: Record<string, SourceInfo>;
  loadedSources: Record<string, true>;
  sourcePeaks: Record<string, Float32Array>;
  transport: TransportState;
  settings: Settings;
  toasts: Toast[];
  importing: boolean;
}

export interface AppActions {
  // tabs
  newTab(): string;
  closeTab(id: string): Promise<void>;
  renameTab(id: string, title: string | null): void;
  setActiveTab(id: string): Promise<void>;
  sleepTab(id: string): Promise<void>;
  wakeTab(id: string): Promise<void>;
  checkSleep(now?: number): Promise<string[]>;

  // import
  addTracksFromPaths(paths: string[]): Promise<number>;
  importFiles(files: File[]): Promise<number>;
  openFilesDialog(): Promise<number>;
  openFolderDialog(): Promise<number>;
  loadPeaks(sourceId: string, buckets?: number): Promise<void>;

  // project edits (undoable, active tab)
  updateProject(recipe: ProjectRecipe, coalesceKey?: string): void;
  removeTrack(id: string): void;
  updateTrack(id: string, patch: TrackFieldsPatch, coalesceKey?: string): void;
  setTrackOffset(id: string, offset: number, coalesceKey?: string): void;
  reorderTrack(id: string, toIndex: number): void;
  trimToSelection(): void;
  splitAtPlayhead(): void;
  deleteSelection(): void;
  arrangeSequential(gap: number, crossfade: number, curve?: FadeCurve): void;
  updateEffects(target: EffectTarget, recipe: (chain: Draft<EffectChain>) => void, coalesceKey?: string): void;
  updateMaster(recipe: (master: Draft<MasterSettings>) => void, coalesceKey?: string): void;
  sealHistory(): void;
  undo(): void;
  redo(): void;

  // view state (not undoable)
  selectTrack(id: string | null): void;
  setSelection(region: Region | null): void;
  setPlayhead(seconds: number): void;
  setViewport(vp: { pxPerSec?: number; scroll?: number }): void;
  setPreviewExport(options: ExportOptions | null): void;
  setExportOptions(options: ExportOptions): void;

  // render results (used by the render loop)
  setRenderStatus(tabId: string, status: RenderStatus, error?: string | null): void;
  setRenderResult(tabId: string, result: RenderResult | null): void;

  // transport
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(seconds: number): Promise<void>;
  step(direction: 1 | -1): Promise<void>;
  setLoop(enabled: boolean): Promise<void>;
  handleTransport(s: TransportState): void;

  // settings
  setLanguage(lang: Language): void;
  setTheme(theme: Theme): void;
  setSleepMinutes(minutes: number): void;
  setStepUnit(unit: StepUnit): void;
  setSnap(snap: boolean): void;
  setColormap(colormap: ColormapName): void;

  // toasts
  /** `context` (e.g. the file name) is prepended to the error detail. */
  pushError(err: unknown, context?: string): void;
  pushInfo(messageKey: string, detail?: string): void;
  dismissToast(id: string): void;
}

export type AppStore = AppState & AppActions;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const SETTINGS_KEY = 'audio-customizer.settings';
export const DEFAULT_PX_PER_SEC = 100;
export const PEAK_BUCKETS = 2048;

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  theme: 'dark',
  sleepMinutes: 5,
  snap: true,
  stepUnit: 'ms100',
  colormap: 'magma',
};

export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings>>(SETTINGS_KEY, {});
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (raw.language === 'en' || raw.language === 'vi') s.language = raw.language;
  if (raw.theme === 'dark' || raw.theme === 'light') s.theme = raw.theme;
  if (typeof raw.sleepMinutes === 'number' && raw.sleepMinutes > 0) s.sleepMinutes = raw.sleepMinutes;
  if (typeof raw.snap === 'boolean') s.snap = raw.snap;
  if (raw.stepUnit && STEP_UNITS.includes(raw.stepUnit)) s.stepUnit = raw.stepUnit;
  if (raw.colormap === 'magma' || raw.colormap === 'inferno') s.colormap = raw.colormap;
  return s;
}

/** Last path segment (works with / and \ separators). */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createTab(number: number, id: string = newId('tab')): Tab {
  return {
    id,
    title: null,
    number,
    project: createDefaultProject(),
    history: hist.createHistory(),
    selectedTrackId: null,
    selection: null,
    playhead: 0,
    pxPerSec: DEFAULT_PX_PER_SEC,
    scroll: 0,
    render: null,
    renderStatus: 'idle',
    renderError: null,
    previewExport: null,
    exportOptions: createDefaultExportOptions(),
    sleeping: false,
    loading: false,
    lastActive: Date.now(),
    renderNonce: 0,
    needsFit: false,
  };
}

export const IDLE_TRANSPORT: TransportState = { state: 'stopped', position: 0, duration: 0, sessionId: null, loop: false };

export function durationsOf(sources: Record<string, SourceInfo>): SourceDurations {
  const d: Record<string, number> = {};
  for (const [id, s] of Object.entries(sources)) d[id] = s.duration;
  return d;
}

/** Source ids used by the given tabs. */
export function sourcesUsedBy(tabs: readonly Tab[]): Set<string> {
  const used = new Set<string>();
  for (const t of tabs) for (const tr of t.project.tracks) used.add(tr.sourceId);
  return used;
}

/** Playable/seekable length of a tab: render duration, else project timeline length. */
export function tabDuration(tab: Tab, sources: Record<string, SourceInfo>): number {
  if (tab.render) return tab.render.duration;
  return projectDuration(tab.project.tracks, durationsOf(sources));
}

function initialState(): AppState {
  const first = createTab(1);
  return {
    tabs: [first],
    activeTabId: first.id,
    sources: {},
    loadedSources: {},
    sourcePeaks: {},
    transport: { ...IDLE_TRANSPORT },
    settings: loadSettings(),
    toasts: [],
    importing: false,
  };
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export interface StoreHooks {
  /** called after the language setting changes (i18n sync) */
  onLanguageChange?: (lang: Language) => void;
}

export function createAppStore(getApi: () => AudioApi, hooks: StoreHooks = {}) {
  return create<AppStore>()((set, get) => {
    const api = (): AudioApi => getApi();

    const activeTab = (): Tab => {
      const s = get();
      return s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0]!;
    };

    const patchTab = (tabId: string, fn: (t: Draft<Tab>) => void): void => {
      set(
        produce((s: Draft<AppState>) => {
          const t = s.tabs.find((x) => x.id === tabId);
          if (t) fn(t);
        }),
      );
    };

    const persistSettings = (): void => writeJson(SETTINGS_KEY, get().settings);

    /** Undoable change on a given tab. */
    const commitTo = (tabId: string, recipe: ProjectRecipe, coalesceKey: string | null = null): boolean => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return false;
      const res = hist.commit(tab.project, tab.history, recipe, coalesceKey);
      if (!res.changed) return false;
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, project: res.project, history: res.history, lastActive: Date.now() } : t,
        ),
      }));
      return true;
    };

    const commitActive = (recipe: ProjectRecipe, coalesceKey?: string): boolean =>
      commitTo(activeTab().id, recipe, coalesceKey ?? null);

    const durations = (): SourceDurations => durationsOf(get().sources);

    /** Unload sources that no awake tab uses (except `keep`). */
    const unloadUnused = async (awakeTabs: readonly Tab[]): Promise<void> => {
      const used = sourcesUsedBy(awakeTabs);
      const loaded = Object.keys(get().loadedSources);
      const toUnload = loaded.filter((id) => !used.has(id));
      if (toUnload.length === 0) return;
      set(
        produce((s: Draft<AppState>) => {
          for (const id of toUnload) delete s.loadedSources[id];
        }),
      );
      await Promise.all(
        toUnload.map((id) =>
          api()
            .unloadSource(id)
            .catch(() => undefined),
        ),
      );
    };

    const loadPaths = async (paths: string[]): Promise<number> => {
      if (paths.length === 0) return 0;
      const tabId = activeTab().id;
      set({ importing: true });
      const infos: SourceInfo[] = [];
      try {
        const results = await Promise.allSettled(paths.map((p) => api().loadSource(p)));
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') infos.push(r.value);
          else get().pushError(r.reason, fileNameOf(paths[i] ?? ''));
        });
        if (infos.length > 0) {
          set(
            produce((s: Draft<AppState>) => {
              for (const info of infos) {
                s.sources[info.id] = info;
                s.loadedSources[info.id] = true;
              }
            }),
          );
          const newIds = infos.map(() => newId('trk'));
          commitTo(tabId, (p) => {
            infos.forEach((info, i) => {
              p.tracks.push(createDefaultTrack(newIds[i]!, info.id, info.name, 0));
            });
          });
          patchTab(tabId, (t) => {
            if (!t.selectedTrackId) t.selectedTrackId = newIds[0] ?? null;
            if (t.project.tracks.length === infos.length) t.needsFit = true;
          });
          for (const info of infos) void get().loadPeaks(info.id);
        }
      } finally {
        set({ importing: false });
      }
      return infos.length;
    };

    return {
      ...initialState(),

      // ----------------------------------------------------------------- tabs
      newTab() {
        const number = Math.max(0, ...get().tabs.map((t) => t.number)) + 1;
        const tab = createTab(number);
        const prev = activeTab();
        set((s) => ({
          tabs: [...s.tabs.map((t) => (t.id === prev.id ? { ...t, lastActive: Date.now() } : t)), tab],
          activeTabId: tab.id,
        }));
        if (get().transport.state === 'playing') void get().pause();
        return tab.id;
      },

      async closeTab(id) {
        const s = get();
        const idx = s.tabs.findIndex((t) => t.id === id);
        if (idx < 0) return;
        if (s.transport.sessionId === id && s.transport.state !== 'stopped') {
          await api()
            .stop()
            .catch(() => undefined);
        }
        let remaining = s.tabs.filter((t) => t.id !== id);
        let activeId = s.activeTabId;
        if (remaining.length === 0) {
          const tab = createTab(1);
          remaining = [tab];
          activeId = tab.id;
        } else if (activeId === id) {
          activeId = remaining[Math.min(idx, remaining.length - 1)]!.id;
        }
        set({ tabs: remaining, activeTabId: activeId });
        await api()
          .releaseSession(id)
          .catch(() => undefined);
        await unloadUnused(remaining.filter((t) => !t.sleeping));
        const next = get().tabs.find((t) => t.id === activeId);
        if (next?.sleeping) await get().wakeTab(next.id);
      },

      renameTab(id, title) {
        const clean = title?.trim() ?? '';
        patchTab(id, (t) => {
          t.title = clean.length > 0 ? clean : null;
        });
      },

      async setActiveTab(id) {
        const s = get();
        if (!s.tabs.some((t) => t.id === id) || s.activeTabId === id) return;
        const now = Date.now();
        set((st) => ({
          activeTabId: id,
          tabs: st.tabs.map((t) => (t.id === st.activeTabId || t.id === id ? { ...t, lastActive: now } : t)),
        }));
        // only the active tab plays
        if (s.transport.state === 'playing' && s.transport.sessionId !== id) await get().pause();
        const tab = get().tabs.find((t) => t.id === id);
        if (tab?.sleeping) await get().wakeTab(id);
      },

      async sleepTab(id) {
        const s = get();
        const tab = s.tabs.find((t) => t.id === id);
        if (!tab || tab.sleeping || id === s.activeTabId) return;
        patchTab(id, (t) => {
          t.sleeping = true;
          t.render = null;
          t.renderStatus = 'idle';
        });
        await api()
          .releaseSession(id)
          .catch(() => undefined);
        await unloadUnused(get().tabs.filter((t) => !t.sleeping));
      },

      async wakeTab(id) {
        const tab = get().tabs.find((t) => t.id === id);
        if (!tab) return;
        if (!tab.sleeping && !tab.loading) return;
        patchTab(id, (t) => {
          t.loading = true;
        });
        const missing = [...new Set(tab.project.tracks.map((t) => t.sourceId))].filter(
          (sid) => !get().loadedSources[sid],
        );
        const results = await Promise.allSettled(
          missing.map((sid) => api().loadSource(get().sources[sid]?.path ?? sid)),
        );
        set(
          produce((st: Draft<AppState>) => {
            for (const r of results) {
              if (r.status === 'fulfilled') {
                st.sources[r.value.id] = r.value;
                st.loadedSources[r.value.id] = true;
              }
            }
          }),
        );
        for (const r of results) if (r.status === 'rejected') get().pushError(r.reason);
        patchTab(id, (t) => {
          t.sleeping = false;
          t.loading = false;
          t.lastActive = Date.now();
          t.renderNonce += 1;
        });
      },

      async checkSleep(now = Date.now()) {
        const s = get();
        const limit = s.settings.sleepMinutes * 60_000;
        const ids = s.tabs
          .filter((t) => t.id !== s.activeTabId && !t.sleeping && now - t.lastActive >= limit)
          .map((t) => t.id);
        for (const id of ids) await get().sleepTab(id);
        return ids;
      },

      // --------------------------------------------------------------- import
      addTracksFromPaths(paths) {
        return loadPaths(paths);
      },

      async importFiles(files) {
        try {
          const raw = files.map((f) => api().getPathForFile(f)).filter((p) => p.length > 0);
          if (raw.length === 0) return 0;
          const paths = await api().expandPaths(raw);
          if (paths.length === 0) {
            get().pushInfo('import.noSupportedFiles');
            return 0;
          }
          return await loadPaths(paths);
        } catch (e) {
          get().pushError(e);
          return 0;
        }
      },

      async openFilesDialog() {
        try {
          return await loadPaths(await api().openFilesDialog());
        } catch (e) {
          get().pushError(e);
          return 0;
        }
      },

      async openFolderDialog() {
        try {
          return await loadPaths(await api().openFolderDialog());
        } catch (e) {
          get().pushError(e);
          return 0;
        }
      },

      async loadPeaks(sourceId, buckets = PEAK_BUCKETS) {
        try {
          const peaks = await api().sourcePeaks(sourceId, buckets);
          set((s) => ({ sourcePeaks: { ...s.sourcePeaks, [sourceId]: peaks } }));
        } catch (e) {
          get().pushError(e);
        }
      },

      // -------------------------------------------------------- project edits
      updateProject(recipe, coalesceKey) {
        commitActive(recipe, coalesceKey);
      },

      removeTrack(id) {
        const tab = activeTab();
        const changed = commitActive((p) => {
          const i = p.tracks.findIndex((t) => t.id === id);
          if (i >= 0) p.tracks.splice(i, 1);
        });
        if (changed && tab.selectedTrackId === id) {
          patchTab(tab.id, (t) => {
            t.selectedTrackId = null;
          });
        }
      },

      updateTrack(id, patch, coalesceKey) {
        commitActive((p) => {
          const t = p.tracks.find((x) => x.id === id);
          if (!t) return;
          for (const [k, v] of Object.entries(patch) as [keyof TrackFieldsPatch, unknown][]) {
            if (v === undefined) continue;
            if (k === 'offset' || k === 'clipStart') (t[k] as number) = Math.max(0, v as number);
            else if (k === 'pan') t.pan = clamp(v as number, -1, 1);
            else (t as unknown as Record<string, unknown>)[k] = v;
          }
        }, coalesceKey);
      },

      setTrackOffset(id, offset, coalesceKey) {
        commitActive((p) => {
          const t = p.tracks.find((x) => x.id === id);
          if (t) t.offset = Math.max(0, offset);
        }, coalesceKey);
      },

      reorderTrack(id, toIndex) {
        commitActive((p) => {
          const from = p.tracks.findIndex((t) => t.id === id);
          if (from < 0) return;
          const to = clamp(Math.round(toIndex), 0, p.tracks.length - 1);
          if (to === from) return;
          const [tr] = p.tracks.splice(from, 1);
          p.tracks.splice(to, 0, tr!);
        });
      },

      trimToSelection() {
        const tab = activeTab();
        const sel = tab.selection;
        if (!sel) return;
        const d = durations();
        const single = tab.selectedTrackId;
        commitActive((p) => {
          const next: Track[] = [];
          for (const t of p.tracks as Track[]) {
            if (single && t.id !== single) {
              next.push(t);
              continue;
            }
            const r = trimTrack(t, sel.start, sel.end, d[t.sourceId] ?? 0);
            if (r) next.push(r);
            else if (single) next.push(t);
          }
          p.tracks = next as Draft<Track>[];
        });
        patchTab(tab.id, (t) => {
          t.selection = null;
          if (t.selectedTrackId && !t.project.tracks.some((x) => x.id === t.selectedTrackId)) t.selectedTrackId = null;
        });
      },

      splitAtPlayhead() {
        const tab = activeTab();
        const at = tab.playhead;
        const d = durations();
        const selected = tab.project.tracks.find((t) => t.id === tab.selectedTrackId);
        const selectedCrosses =
          selected && at > selected.offset && at < trackEnd(selected, d[selected.sourceId] ?? 0);
        commitActive((p) => {
          const next: Track[] = [];
          for (const t of p.tracks as Track[]) {
            const eligible = selectedCrosses ? t.id === selected.id : true;
            const parts = eligible ? splitTrack(t, at, d[t.sourceId] ?? 0, newId('trk')) : null;
            if (parts) next.push(parts[0], parts[1]);
            else next.push(t);
          }
          p.tracks = next as Draft<Track>[];
        });
      },

      deleteSelection() {
        const tab = activeTab();
        const sel = tab.selection;
        if (!sel) return;
        const d = durations();
        commitActive((p) => {
          p.tracks = rippleDelete(p.tracks as Track[], sel.start, sel.end, d, () => newId('trk')) as Draft<Track>[];
        });
        patchTab(tab.id, (t) => {
          t.selection = null;
          if (t.playhead > sel.start) t.playhead = Math.max(sel.start, t.playhead - Math.abs(sel.end - sel.start));
          if (t.selectedTrackId && !t.project.tracks.some((x) => x.id === t.selectedTrackId)) t.selectedTrackId = null;
        });
      },

      arrangeSequential(gap, crossfade, curve = 'equalPower') {
        const d = durations();
        commitActive((p) => {
          p.tracks = arrangeTracks(p.tracks as Track[], d, gap, crossfade, curve) as Draft<Track>[];
        });
      },

      updateEffects(target, recipe, coalesceKey) {
        commitActive((p) => {
          if (target === 'master') {
            recipe(p.master.effects);
            return;
          }
          const t = p.tracks.find((x) => x.id === target);
          if (t) recipe(t.effects);
        }, coalesceKey);
      },

      updateMaster(recipe, coalesceKey) {
        commitActive((p) => recipe(p.master), coalesceKey);
      },

      sealHistory() {
        const tab = activeTab();
        const sealed = hist.seal(tab.history);
        if (sealed !== tab.history) {
          set((s) => ({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, history: sealed } : t)) }));
        }
      },

      undo() {
        const tab = activeTab();
        const r = hist.undo(tab.project, tab.history);
        if (!r) return;
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  project: r.project,
                  history: r.history,
                  selectedTrackId: r.project.tracks.some((x) => x.id === t.selectedTrackId) ? t.selectedTrackId : null,
                }
              : t,
          ),
        }));
      },

      redo() {
        const tab = activeTab();
        const r = hist.redo(tab.project, tab.history);
        if (!r) return;
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  project: r.project,
                  history: r.history,
                  selectedTrackId: r.project.tracks.some((x) => x.id === t.selectedTrackId) ? t.selectedTrackId : null,
                }
              : t,
          ),
        }));
      },

      // ----------------------------------------------------------- view state
      selectTrack(id) {
        patchTab(activeTab().id, (t) => {
          t.selectedTrackId = id;
        });
      },

      setSelection(region) {
        patchTab(activeTab().id, (t) => {
          if (!region || Math.abs(region.end - region.start) < 1e-6) t.selection = null;
          else
            t.selection = {
              start: Math.max(0, Math.min(region.start, region.end)),
              end: Math.max(region.start, region.end),
            };
        });
      },

      setPlayhead(seconds) {
        patchTab(activeTab().id, (t) => {
          t.playhead = Math.max(0, seconds);
        });
      },

      setViewport(vp) {
        patchTab(activeTab().id, (t) => {
          if (vp.pxPerSec !== undefined && vp.pxPerSec > 0) {
            t.pxPerSec = vp.pxPerSec;
            t.needsFit = false;
          }
          if (vp.scroll !== undefined) t.scroll = Math.max(0, vp.scroll);
        });
      },

      setPreviewExport(options) {
        patchTab(activeTab().id, (t) => {
          t.previewExport = options ? { ...options } : null;
        });
      },

      setExportOptions(options) {
        patchTab(activeTab().id, (t) => {
          t.exportOptions = { ...options };
        });
      },

      setRenderStatus(tabId, status, error = null) {
        patchTab(tabId, (t) => {
          t.renderStatus = status;
          t.renderError = error;
        });
      },

      setRenderResult(tabId, result) {
        patchTab(tabId, (t) => {
          t.render = result as Draft<RenderResult> | null;
          t.renderStatus = 'idle';
          t.renderError = null;
          if (result && t.playhead > result.duration) t.playhead = result.duration;
        });
      },

      // ------------------------------------------------------------ transport
      async play() {
        const tab = activeTab();
        if (!tab.render || tab.sleeping) return;
        try {
          const tr = get().transport;
          const pos = tab.playhead >= tab.render.duration - 1e-6 ? 0 : tab.playhead;
          if (tr.sessionId !== tab.id || tr.state === 'stopped' || Math.abs(tr.position - pos) > 1e-3) {
            await api().seek(pos);
          }
          await api().play(tab.id);
          set((s) => ({ transport: { ...s.transport, state: 'playing', sessionId: tab.id } }));
        } catch (e) {
          get().pushError(e);
        }
      },

      async pause() {
        try {
          await api().pause();
          set((s) => ({ transport: { ...s.transport, state: s.transport.state === 'playing' ? 'paused' : s.transport.state } }));
        } catch (e) {
          get().pushError(e);
        }
      },

      async stop() {
        try {
          await api().stop();
          set((s) => ({ transport: { ...s.transport, state: 'stopped', position: 0 } }));
          patchTab(activeTab().id, (t) => {
            t.playhead = 0;
          });
        } catch (e) {
          get().pushError(e);
        }
      },

      async togglePlay() {
        const tr = get().transport;
        if (tr.state === 'playing' && tr.sessionId === get().activeTabId) await get().pause();
        else await get().play();
      },

      async seek(seconds) {
        const tab = activeTab();
        const dur = tabDuration(tab, get().sources);
        const t = clamp(seconds, 0, dur);
        patchTab(tab.id, (x) => {
          x.playhead = t;
        });
        const tr = get().transport;
        if (tr.sessionId === tab.id || tr.sessionId === null) {
          set((s) => ({ transport: { ...s.transport, position: t } }));
          try {
            await api().seek(t);
          } catch (e) {
            get().pushError(e);
          }
        }
      },

      async step(direction) {
        const tab = activeTab();
        const s = get();
        const dur = tabDuration(tab, s.sources);
        const sr = tab.render?.sampleRate ?? 44100;
        await get().seek(stepPosition(tab.playhead, direction, s.settings.stepUnit, dur, sr));
      },

      async setLoop(enabled) {
        set((s) => ({ transport: { ...s.transport, loop: enabled } }));
        try {
          await api().setLoop(enabled);
        } catch (e) {
          get().pushError(e);
        }
      },

      handleTransport(tr) {
        set({ transport: { ...tr } });
        const activeId = get().activeTabId;
        if (tr.sessionId === activeId) {
          patchTab(activeId, (t) => {
            t.playhead = tr.position;
          });
        }
      },

      // ------------------------------------------------------------- settings
      setLanguage(lang) {
        set((s) => ({ settings: { ...s.settings, language: lang } }));
        persistSettings();
        hooks.onLanguageChange?.(lang);
      },

      setTheme(theme) {
        set((s) => ({ settings: { ...s.settings, theme } }));
        persistSettings();
      },

      setSleepMinutes(minutes) {
        const m = clamp(Math.round(minutes), 1, 240);
        set((s) => ({ settings: { ...s.settings, sleepMinutes: m } }));
        persistSettings();
      },

      setStepUnit(unit) {
        set((s) => ({ settings: { ...s.settings, stepUnit: unit } }));
        persistSettings();
      },

      setSnap(snap) {
        set((s) => ({ settings: { ...s.settings, snap } }));
        persistSettings();
      },

      setColormap(colormap) {
        set((s) => ({ settings: { ...s.settings, colormap } }));
        persistSettings();
      },

      // --------------------------------------------------------------- toasts
      pushError(err, context) {
        const detail = errorDetailOf(err);
        const full = context ? (detail ? `${context}: ${detail}` : context) : detail;
        const toast: Toast = { id: newId('toast'), kind: 'error', code: errorCodeOf(err), detail: full };
        set((s) => ({ toasts: [...s.toasts.slice(-4), toast] }));
      },

      pushInfo(messageKey, detail = '') {
        const toast: Toast = { id: newId('toast'), kind: 'info', messageKey, detail };
        set((s) => ({ toasts: [...s.toasts.slice(-4), toast] }));
      },

      dismissToast(id) {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
    };
  });
}

export type AppStoreHook = ReturnType<typeof createAppStore>;

/** Fresh initial state (used by tests to reset the singleton store). */
export function freshState(): AppState {
  return initialState();
}
