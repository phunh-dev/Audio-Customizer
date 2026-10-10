/**
 * PUBLIC STORE API — import from '@renderer/store' (or a relative path).
 *
 * The store is a single zustand hook `useAppStore`. Read state with a selector
 * (`useAppStore((s) => s.settings.language)`) or with the helper hooks below.
 * Every project mutation is undoable (per-tab history, immer patches).
 *
 * Effect panels (Agent C2) use:
 *   updateEffects(target, recipe, coalesceKey?)
 *       target: 'master' | trackId ; recipe mutates a draft EffectChain:
 *       updateEffects('master', (c) => { c.eq.bands[3].gainDb = 6 }, 'eq.band3.gain')
 *   updateMaster(recipe, coalesceKey?)
 *       recipe mutates a draft MasterSettings (effects, loop, trimSilence):
 *       updateMaster((m) => { m.loop.crossfadeMs = 250 }, 'loop.crossfade')
 *   setPreviewExport(options | null)   // apply export settings to the preview render
 *   setExportOptions(options)          // remember export settings in the tab
 *   sealHistory()                      // call on pointer-up to end a coalesced gesture
 *
 * Coalescing: consecutive calls with the same `coalesceKey` within 1 s are merged
 * into ONE undo step (use it for slider drags / text input). Omit it for discrete
 * changes (toggles, selects, buttons). A new change clears the redo stack.
 *
 * Useful read hooks: useActiveTab(), useActiveProject(), useSelectedTrack(),
 * useEffectTarget() ('master' or the selected track id), useSessionId().
 * Imperative access: getStore() (= useAppStore.getState()).
 */
import { useAppStore as store } from './singleton';
import type { AppStore, Tab } from './appStore';
import type { EffectChain, EffectTarget, ExportOptions, MasterSettings, Project, Track } from '@shared/types';
import type { Draft } from 'immer';

export { useAppStore, resetAppStore } from './singleton';
export type {
  AppActions,
  AppState,
  AppStore,
  Language,
  Region,
  RenderStatus,
  Settings,
  Tab,
  Theme,
  Toast,
  TrackFieldsPatch,
} from './appStore';
export { DEFAULT_SETTINGS, durationsOf, tabDuration, sourcesUsedBy } from './appStore';
export type { ProjectRecipe } from './history';

export function getStore(): AppStore {
  return store.getState();
}

export function selectActiveTab(s: AppStore): Tab {
  return s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0]!;
}

export function useActiveTab(): Tab {
  return store(selectActiveTab);
}

export function useActiveProject(): Project {
  return store((s) => selectActiveTab(s).project);
}

export function useSessionId(): string {
  return store((s) => s.activeTabId);
}

export function useSelectedTrack(): Track | null {
  return store((s) => {
    const tab = selectActiveTab(s);
    return tab.project.tracks.find((t) => t.id === tab.selectedTrackId) ?? null;
  });
}

/** 'master' when no track is selected, otherwise the selected track id. */
export function useEffectTarget(): EffectTarget {
  return store((s) => selectActiveTab(s).selectedTrackId ?? 'master');
}

/** Effect chain of a target in the active tab (null if the track does not exist). */
export function selectEffectChain(s: AppStore, target: EffectTarget): EffectChain | null {
  const p = selectActiveTab(s).project;
  if (target === 'master') return p.master.effects;
  return p.tracks.find((t) => t.id === target)?.effects ?? null;
}

export function useEffectChain(target: EffectTarget): EffectChain | null {
  return store((s) => selectEffectChain(s, target));
}

export function useCanUndo(): boolean {
  return store((s) => selectActiveTab(s).history.past.length > 0);
}

export function useCanRedo(): boolean {
  return store((s) => selectActiveTab(s).history.future.length > 0);
}

// ---- imperative shortcuts (stable function references) ----------------------

export function updateEffects(
  target: EffectTarget,
  recipe: (chain: Draft<EffectChain>) => void,
  coalesceKey?: string,
): void {
  store.getState().updateEffects(target, recipe, coalesceKey);
}

export function updateMaster(recipe: (master: Draft<MasterSettings>) => void, coalesceKey?: string): void {
  store.getState().updateMaster(recipe, coalesceKey);
}

export function setPreviewExport(options: ExportOptions | null): void {
  store.getState().setPreviewExport(options);
}

export function setExportOptions(options: ExportOptions): void {
  store.getState().setExportOptions(options);
}

export function sealHistory(): void {
  store.getState().sealHistory();
}

export function undo(): void {
  store.getState().undo();
}

export function redo(): void {
  store.getState().redo();
}
