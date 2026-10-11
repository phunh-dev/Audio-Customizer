/**
 * Patch-based undo/redo history (immer produceWithPatches).
 * Each tab owns one History. Continuous gestures (slider drags, clip drags)
 * pass the same `coalesceKey` and are merged into a single undo step while
 * they happen within COALESCE_WINDOW_MS of each other.
 */
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import type { Project } from '@shared/types';

enablePatches();

export const HISTORY_CAP = 200;
export const COALESCE_WINDOW_MS = 1000;

export interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
  coalesceKey: string | null;
  time: number;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export type ProjectRecipe = (draft: Draft<Project>) => void;

export function createHistory(): History {
  return { past: [], future: [] };
}

export interface CommitResult {
  project: Project;
  history: History;
  changed: boolean;
}

/**
 * Apply `recipe` to `project` and record the change. A new change clears the
 * redo stack. No-op recipes leave project and history untouched.
 */
export function commit(
  project: Project,
  history: History,
  recipe: ProjectRecipe,
  coalesceKey: string | null = null,
  now: number = Date.now(),
  cap: number = HISTORY_CAP,
): CommitResult {
  const [next, patches, inversePatches] = produceWithPatches(project, recipe);
  if (patches.length === 0) return { project, history, changed: false };
  const last = history.past[history.past.length - 1];
  if (
    coalesceKey !== null &&
    last &&
    last.coalesceKey === coalesceKey &&
    history.future.length === 0 &&
    now - last.time <= COALESCE_WINDOW_MS
  ) {
    const merged: HistoryEntry = {
      patches: [...last.patches, ...patches],
      inversePatches: [...inversePatches, ...last.inversePatches],
      coalesceKey,
      time: now,
    };
    return { project: next, history: { past: [...history.past.slice(0, -1), merged], future: [] }, changed: true };
  }
  const entry: HistoryEntry = { patches, inversePatches, coalesceKey, time: now };
  const past = [...history.past, entry];
  if (past.length > cap) past.splice(0, past.length - cap);
  return { project: next, history: { past, future: [] }, changed: true };
}

/** Close the current coalescing group so the next change starts a new undo step. */
export function seal(history: History): History {
  const last = history.past[history.past.length - 1];
  if (!last || last.coalesceKey === null) return history;
  return { ...history, past: [...history.past.slice(0, -1), { ...last, coalesceKey: null }] };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

export function undo(project: Project, history: History): { project: Project; history: History } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    project: applyPatches(project, entry.inversePatches),
    history: { past: history.past.slice(0, -1), future: [{ ...entry, coalesceKey: null }, ...history.future] },
  };
}

export function redo(project: Project, history: History): { project: Project; history: History } | null {
  const entry = history.future[0];
  if (!entry) return null;
  return {
    project: applyPatches(project, entry.patches),
    history: { past: [...history.past, entry], future: history.future.slice(1) },
  };
}
