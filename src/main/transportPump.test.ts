import { describe, expect, it, vi } from 'vitest';
import type { TransportState } from '@shared/api';
import { createTransportPump, TRANSPORT_PUSH_INTERVAL_MS, type Timers } from './transportPump';

function fakeTimers() {
  const active = new Map<number, () => void>();
  let next = 1;
  const timers: Timers = {
    setInterval: vi.fn((fn: () => void) => {
      const id = next++;
      active.set(id, fn);
      return id;
    }),
    clearInterval: vi.fn((h: unknown) => {
      active.delete(h as number);
    }),
  };
  const tick = () => [...active.values()].forEach((f) => f());
  return { timers, active, tick };
}

const st = (state: TransportState['state'], position = 0): TransportState => ({
  state,
  position,
  duration: 10,
  sessionId: 's',
  loop: false,
});

describe('transport pump', () => {
  it('pushes on notify and polls ~30 Hz while playing', () => {
    let current = st('playing', 0);
    const send = vi.fn();
    const { timers, active, tick } = fakeTimers();
    const pump = createTransportPump({ getState: () => current, send, timers });
    pump.notify();
    expect(send).toHaveBeenCalledTimes(1);
    expect(pump.running).toBe(true);
    expect(timers.setInterval).toHaveBeenCalledWith(expect.any(Function), TRANSPORT_PUSH_INTERVAL_MS);
    expect(TRANSPORT_PUSH_INTERVAL_MS).toBeGreaterThanOrEqual(25);
    expect(TRANSPORT_PUSH_INTERVAL_MS).toBeLessThanOrEqual(40);
    current = st('playing', 0.1);
    tick();
    current = st('playing', 0.2);
    tick();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]![0].position).toBe(0.2);
    // Unchanged state is not re-sent by the timer.
    tick();
    expect(send).toHaveBeenCalledTimes(3);
    // Reaching the end (engine pauses) -> one last push, timer stops.
    current = st('paused', 10);
    tick();
    expect(send).toHaveBeenCalledTimes(4);
    expect(pump.running).toBe(false);
    expect(active.size).toBe(0);
  });

  it('notify always pushes, even if unchanged, and does not poll when idle', () => {
    const send = vi.fn();
    const { timers } = fakeTimers();
    const pump = createTransportPump({ getState: () => st('stopped'), send, timers });
    pump.notify();
    pump.notify();
    expect(send).toHaveBeenCalledTimes(2);
    expect(timers.setInterval).not.toHaveBeenCalled();
    expect(pump.running).toBe(false);
  });

  it('does not start two timers', () => {
    const { timers } = fakeTimers();
    const pump = createTransportPump({ getState: () => st('playing'), send: () => {}, timers });
    pump.notify();
    pump.notify();
    expect(timers.setInterval).toHaveBeenCalledTimes(1);
  });

  it('dispose stops everything', () => {
    const send = vi.fn();
    const { timers, active } = fakeTimers();
    const pump = createTransportPump({ getState: () => st('playing'), send, timers });
    pump.notify();
    pump.dispose();
    expect(active.size).toBe(0);
    pump.notify();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a throwing getState stops polling without crashing', () => {
    const send = vi.fn();
    const { timers, active, tick } = fakeTimers();
    let fail = false;
    const pump = createTransportPump({
      getState: () => {
        if (fail) throw new Error('ERR_IO: addon');
        return st('playing');
      },
      send,
      timers,
    });
    pump.notify();
    fail = true;
    expect(() => tick()).not.toThrow();
    expect(active.size).toBe(0);
    expect(() => pump.notify()).not.toThrow();
  });

  it('works with real timers', async () => {
    vi.useFakeTimers();
    try {
      let pos = 0;
      const send = vi.fn();
      const pump = createTransportPump({ getState: () => st('playing', (pos += 0.033)), send });
      pump.notify();
      vi.advanceTimersByTime(1000);
      expect(send.mock.calls.length).toBeGreaterThanOrEqual(25);
      pump.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
