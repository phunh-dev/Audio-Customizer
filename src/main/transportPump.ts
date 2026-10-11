/**
 * Pushes the transport state to the renderer: ~30 Hz while playing, and
 * immediately on every change (`notify`). Stops polling when not playing.
 */
import type { TransportState } from '@shared/api';

export const TRANSPORT_PUSH_INTERVAL_MS = 33;

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface TransportPumpDeps {
  getState(): TransportState;
  send(state: TransportState): void;
  intervalMs?: number;
  timers?: Timers;
}

export interface TransportPump {
  /** Something changed: push now and (re)start polling if playing. */
  notify(): void;
  /** Whether the periodic timer is running. */
  readonly running: boolean;
  dispose(): void;
}

const defaultTimers: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export function createTransportPump(deps: TransportPumpDeps): TransportPump {
  const timers = deps.timers ?? defaultTimers;
  const intervalMs = deps.intervalMs ?? TRANSPORT_PUSH_INTERVAL_MS;
  let handle: unknown = null;
  let last: string | null = null;
  let disposed = false;

  const stopTimer = () => {
    if (handle !== null) {
      timers.clearInterval(handle);
      handle = null;
    }
  };

  const tick = (force: boolean) => {
    if (disposed) return;
    let state: TransportState;
    try {
      state = deps.getState();
    } catch {
      stopTimer();
      return;
    }
    const key = JSON.stringify(state);
    if (force || key !== last) {
      last = key;
      deps.send(state);
    }
    if (state.state === 'playing') {
      if (handle === null) handle = timers.setInterval(() => tick(false), intervalMs);
    } else {
      stopTimer();
    }
  };

  return {
    notify: () => tick(true),
    get running() {
      return handle !== null;
    },
    dispose: () => {
      disposed = true;
      stopTimer();
    },
  };
}
