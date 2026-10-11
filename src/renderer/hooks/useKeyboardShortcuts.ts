import { useEffect } from 'react';
import { useAppStore } from '../store';

/** True when the event target is a text field / slider that owns the key. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(type);
  }
  const role = target.getAttribute('role');
  return role === 'slider' || role === 'spinbutton' || role === 'textbox' || role === 'combobox';
}

/**
 * True when the target types text (so Space must stay a character). Sliders,
 * knobs and the timeline ruler do not use Space: there it still plays/pauses.
 */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const role = target.getAttribute('role');
  if (role === 'slider' || role === 'spinbutton') return false;
  return isEditableTarget(target);
}

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

export type ShortcutAction = 'togglePlay' | 'undo' | 'redo' | 'stepBack' | 'stepForward' | 'deleteSelection' | 'split' | null;

/** Map a key event to an app action (pure, testable). */
export function shortcutFor(e: ShortcutEvent): ShortcutAction {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && !e.altKey) {
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    return null;
  }
  if (e.altKey) return null;
  if (key === ' ' || e.key === 'Spacebar') return isTextTarget(e.target) ? null : 'togglePlay';
  if (isEditableTarget(e.target)) return null;
  if (key === 'ArrowLeft') return 'stepBack';
  if (key === 'ArrowRight') return 'stepForward';
  if (key === 'Delete' || key === 'Backspace') return 'deleteSelection';
  if (key === 's' && !e.shiftKey) return 'split';
  return null;
}

/** Global keyboard shortcuts (attached to window). */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const action = shortcutFor(e);
      if (!action) return;
      // undo/redo inside a text field keeps the native behaviour
      if (
        (action === 'undo' || action === 'redo') &&
        e.target instanceof HTMLElement &&
        isEditableTarget(e.target) &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      e.preventDefault();
      const s = useAppStore.getState();
      switch (action) {
        case 'togglePlay':
          void s.togglePlay();
          break;
        case 'undo':
          s.undo();
          break;
        case 'redo':
          s.redo();
          break;
        case 'stepBack':
          void s.step(-1);
          break;
        case 'stepForward':
          void s.step(1);
          break;
        case 'deleteSelection':
          s.deleteSelection();
          break;
        case 'split':
          s.splitAtPlayhead();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
