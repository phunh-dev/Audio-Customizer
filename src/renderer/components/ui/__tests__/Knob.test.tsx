import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Knob } from '../Knob';
import { dragVertical } from '../testUtils';

function Controlled(props: { onChange?: (v: number) => void; onCommit?: (v: number) => void; initial?: number; scale?: 'linear' | 'log' }) {
  const [v, setV] = useState(props.initial ?? 0);
  return (
    <Knob
      aria-label="Gain"
      label="Gain"
      unit="dB"
      min={-10}
      max={10}
      step={1}
      scale={props.scale}
      defaultValue={0}
      value={v}
      onChange={(n) => {
        setV(n);
        props.onChange?.(n);
      }}
      onCommit={props.onCommit}
    />
  );
}

describe('Knob', () => {
  it('exposes slider semantics with aria values', () => {
    render(<Controlled initial={3} />);
    const k = screen.getByRole('slider', { name: 'Gain' });
    expect(k).toHaveAttribute('aria-valuenow', '3');
    expect(k).toHaveAttribute('aria-valuemin', '-10');
    expect(k).toHaveAttribute('aria-valuemax', '10');
    expect(k).toHaveAttribute('aria-valuetext', '3 dB');
  });

  it('steps with arrow keys, jumps with PageUp/Home/End and commits each key', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    const k = screen.getByRole('slider', { name: 'Gain' });
    fireEvent.keyDown(k, { key: 'ArrowUp' });
    expect(k).toHaveAttribute('aria-valuenow', '1');
    fireEvent.keyDown(k, { key: 'ArrowLeft' });
    fireEvent.keyDown(k, { key: 'ArrowDown' });
    expect(k).toHaveAttribute('aria-valuenow', '-1');
    fireEvent.keyDown(k, { key: 'PageUp' });
    expect(k).toHaveAttribute('aria-valuenow', '9');
    fireEvent.keyDown(k, { key: 'End' });
    expect(k).toHaveAttribute('aria-valuenow', '10');
    fireEvent.keyDown(k, { key: 'ArrowUp' });
    expect(k).toHaveAttribute('aria-valuenow', '10'); // clamped
    fireEvent.keyDown(k, { key: 'Home' });
    expect(k).toHaveAttribute('aria-valuenow', '-10');
    expect(onCommit).toHaveBeenCalledTimes(7);
  });

  it('double-click resets to the default value', () => {
    const onCommit = vi.fn();
    render(<Controlled initial={7} onCommit={onCommit} />);
    const k = screen.getByRole('slider', { name: 'Gain' });
    fireEvent.doubleClick(k);
    expect(k).toHaveAttribute('aria-valuenow', '0');
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it('vertical drag changes the value and commits once; Shift drags finely', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Controlled onChange={onChange} onCommit={onCommit} />);
    const k = screen.getByRole('slider', { name: 'Gain' });
    dragVertical(k, 100); // half of the 200 px full sweep -> +10 (half of 20)
    expect(k).toHaveAttribute('aria-valuenow', '10');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls.length).toBeGreaterThan(1);

    onCommit.mockClear();
    fireEvent.doubleClick(k);
    onCommit.mockClear();
    dragVertical(k, 100, { shiftKey: true }); // fine: 10x less -> +1
    expect(k).toHaveAttribute('aria-valuenow', '1');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('mouse wheel nudges and commits after the wheel stops', () => {
    vi.useFakeTimers();
    try {
      const onCommit = vi.fn();
      render(<Controlled onCommit={onCommit} />);
      const k = screen.getByRole('slider', { name: 'Gain' });
      fireEvent.wheel(k, { deltaY: -100 });
      fireEvent.wheel(k, { deltaY: -100 });
      expect(k).toHaveAttribute('aria-valuenow', '2');
      expect(onCommit).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('log scale moves by position steps', () => {
    function LogKnob() {
      const [v, setV] = useState(1000);
      return <Knob aria-label="Freq" min={20} max={20000} step={1} scale="log" value={v} onChange={setV} />;
    }
    render(<LogKnob />);
    const k = screen.getByRole('slider', { name: 'Freq' });
    fireEvent.keyDown(k, { key: 'ArrowUp' });
    const v = Number(k.getAttribute('aria-valuenow'));
    expect(v).toBeGreaterThan(1050);
    expect(v).toBeLessThan(1090);
  });

  it('ignores input when disabled', () => {
    const onChange = vi.fn();
    render(<Knob aria-label="Off" min={0} max={10} step={1} value={5} onChange={onChange} disabled defaultValue={0} />);
    const k = screen.getByRole('slider', { name: 'Off' });
    fireEvent.keyDown(k, { key: 'ArrowUp' });
    fireEvent.doubleClick(k);
    dragVertical(k, 50);
    expect(onChange).not.toHaveBeenCalled();
    expect(k).toHaveAttribute('aria-disabled', 'true');
  });
});
