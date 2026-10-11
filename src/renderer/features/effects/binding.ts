/**
 * Binding helpers between controls and the store. Continuous controls call
 * `onChange` with a coalesce key (so one drag = one undo step) and `onCommit`
 * seals the history at the end of the gesture. Discrete controls (switches,
 * selects, buttons) write without a key (one click = one undo step).
 * Continuous edits of a switched-off module turn it on (see `autoEnable`).
 */
import type { Draft } from 'immer';
import type { EffectChain, EffectTarget, MasterSettings } from '@shared/types';
import { sealHistory, updateEffects, updateMaster } from '@renderer/store';

type Obj = Record<string, unknown>;

/** Read a dotted path ("eq.bands.3.gainDb") from an object. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Obj)[k];
  }
  return cur;
}

/** Write a dotted path on a (draft) object. Missing parents are ignored. */
export function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop();
  if (last === undefined) return;
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined) return;
    cur = (cur as Obj)[k];
  }
  if (cur !== null && cur !== undefined) (cur as Obj)[last] = value;
}

/** Effect modules that have an on/off switch, per binder scope. */
const SWITCHABLE_CHAIN = ['denoise', 'pitchTempo', 'filters', 'eq'];
const SWITCHABLE_MASTER = ['loop', 'trimSilence'];

/**
 * Path of the `enabled` flag of the module that owns `path`, or null.
 * 'eq.bands.3.gainDb' -> 'eq.enabled'; master 'effects.eq.bands.0.q' -> 'effects.eq.enabled'.
 */
export function moduleSwitchPath(path: string, kind: 'chain' | 'master'): string | null {
  const parts = path.split('.');
  let prefix: string[];
  if (kind === 'master' && parts[0] === 'effects') prefix = SWITCHABLE_CHAIN.includes(parts[1] ?? '') ? parts.slice(0, 2) : [];
  else if (kind === 'master') prefix = SWITCHABLE_MASTER.includes(parts[0] ?? '') ? parts.slice(0, 1) : [];
  else prefix = SWITCHABLE_CHAIN.includes(parts[0] ?? '') ? parts.slice(0, 1) : [];
  if (prefix.length === 0 || parts.length <= prefix.length) return null;
  const switchPath = [...prefix, 'enabled'].join('.');
  return switchPath === path ? null : switchPath;
}

/**
 * Editing a value of a module that is switched off turns the module on, so the
 * change is heard right away (a first-time user would otherwise hear nothing).
 */
export function autoEnable(draft: unknown, path: string, kind: 'chain' | 'master'): void {
  const sw = moduleSwitchPath(path, kind);
  if (sw && getPath(draft, sw) === false) setPath(draft, sw, true);
}

export function coalesceKeyFor(scope: string, path: string): string {
  return `fx:${scope}:${path}`;
}

export interface NumberBinding {
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}

export interface Binder<T> {
  /** Live object (from the store) the paths are read from. */
  readonly source: T;
  /** Continuous change (coalesced with the same path). */
  change(path: string, recipe: (draft: Draft<T>) => void): void;
  /** Discrete change (own undo step). */
  apply(recipe: (draft: Draft<T>) => void): void;
  /** End of a gesture. */
  commit(): void;
  /** Props for a numeric control bound to `path`. */
  num(path: string): NumberBinding;
  /** Discrete setter for `path`. */
  set(path: string, value: unknown): void;
}

function makeBinder<T>(
  source: T,
  scope: string,
  write: (recipe: (draft: Draft<T>) => void, key?: string) => void,
  kind: 'chain' | 'master',
): Binder<T> {
  const b: Binder<T> = {
    source,
    change: (path, recipe) =>
      write((d) => {
        recipe(d);
        autoEnable(d, path, kind);
      }, coalesceKeyFor(scope, path)),
    apply: (recipe) => {
      sealHistory();
      write(recipe);
    },
    commit: () => sealHistory(),
    num: (path) => ({
      value: Number(getPath(source, path) ?? 0),
      onChange: (v) =>
        write((d) => {
          setPath(d, path, v);
          autoEnable(d, path, kind);
        }, coalesceKeyFor(scope, path)),
      onCommit: () => sealHistory(),
    }),
    set: (path, value) => b.apply((d) => setPath(d, path, value)),
  };
  return b;
}

/** Binder on the effect chain of `target` ('master' or a track id). */
export function effectsBinder(target: EffectTarget, chain: EffectChain): Binder<EffectChain> {
  return makeBinder(chain, target, (recipe, key) => updateEffects(target, recipe, key), 'chain');
}

/** Binder on the master settings (loop, trim silence, master effects). */
export function masterBinder(master: MasterSettings): Binder<MasterSettings> {
  return makeBinder(master, 'master-settings', (recipe, key) => updateMaster(recipe, key), 'master');
}
