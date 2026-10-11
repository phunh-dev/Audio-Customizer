import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Slider, SliderField } from '../Slider';
import '../testUtils';

function Field(props: { onChange?: (v: number) => void; onCommit?: (v: number) => void; initial?: number; log?: boolean; disabled?: boolean }) {
  const [v, setV] = useState(props.initial ?? (props.log ? 1000 : 0));
  return (
    <SliderField
      label="Gain"
      hint="Explanation"
      unit={props.log ? 'Hz' : 'dB'}
      min={props.log ? 20 : -60}
      max={props.log ? 20000 : 24}
      step={props.log ? 1 : 0.5}
      scale={props.log ? 'log' : 'linear'}
      defaultValue={props.log ? 1000 : 0}
      disabled={props.disabled}
      value={v}
      onChange={(n) => {
        setV(n);
        props.onChange?.(n);
      }}
      onCommit={props.onCommit}
    />
  );
}

describe('Slider / SliderField', () => {
  it('renders a labelled slider and number field', () => {
    render(<Field initial={-6} />);
    const s = screen.getByRole('slider', { name: 'Gain' });
    expect(s).toHaveAttribute('aria-valuenow', '-6');
    expect(s).toHaveAttribute('aria-valuetext', '-6.0 dB');
    expect(screen.getByRole('spinbutton', { name: 'Gain' })).toHaveValue('-6.0');
    expect(screen.getByRole('img', { name: 'Gain' })).toBeInTheDocument(); // info tip
  });

  it('keyboard changes the value, clamps and commits', () => {
    const onCommit = vi.fn();
    render(<Field onCommit={onCommit} />);
    const s = screen.getByRole('slider', { name: 'Gain' });
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    expect(s).toHaveAttribute('aria-valuenow', '0.5');
    fireEvent.keyDown(s, { key: 'End' });
    expect(s).toHaveAttribute('aria-valuenow', '24');
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    expect(s).toHaveAttribute('aria-valuenow', '24');
    fireEvent.keyDown(s, { key: 'Home' });
    expect(s).toHaveAttribute('aria-valuenow', '-60');
    expect(onCommit).toHaveBeenCalled();
  });

  it('typed entry is clamped and synced to the slider', () => {
    render(<Field />);
    const f = screen.getByRole('spinbutton', { name: 'Gain' });
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: '-99' } });
    fireEvent.keyDown(f, { key: 'Enter' });
    expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '-60');
  });

  it('double-click on the thumb or the label resets to default', () => {
    const onCommit = vi.fn();
    render(<Field initial={12} onCommit={onCommit} />);
    const s = screen.getByRole('slider', { name: 'Gain' });
    fireEvent.doubleClick(s);
    expect(s).toHaveAttribute('aria-valuenow', '0');
    fireEvent.keyDown(s, { key: 'End' });
    fireEvent.doubleClick(screen.getByText('Gain'));
    expect(s).toHaveAttribute('aria-valuenow', '0');
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it('log scale reports real values and moves logarithmically', () => {
    render(<Field log />);
    const s = screen.getByRole('slider', { name: 'Gain' });
    expect(s).toHaveAttribute('aria-valuenow', '1000');
    expect(s).toHaveAttribute('aria-valuemin', '20');
    expect(s).toHaveAttribute('aria-valuemax', '20000');
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    const v = Number(s.getAttribute('aria-valuenow'));
    expect(v).toBeGreaterThan(1000);
    expect(v).toBeLessThan(1020);
    const f = screen.getByRole('spinbutton', { name: 'Gain' });
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: '2.5k' } });
    fireEvent.keyDown(f, { key: 'Enter' });
    expect(s).toHaveAttribute('aria-valuenow', '2500');
  });

  it('disabled slider does not reset', () => {
    const onChange = vi.fn();
    render(<Field initial={5} disabled onChange={onChange} />);
    fireEvent.doubleClick(screen.getByText('Gain'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('vertical slider supports origin fill and aria orientation', () => {
    render(<Slider aria-label="Band" orientation="vertical" origin={0} min={-18} max={18} step={0.1} value={6} onChange={() => undefined} />);
    const s = screen.getByRole('slider', { name: 'Band' });
    expect(s).toHaveAttribute('aria-orientation', 'vertical');
    expect(s).toHaveAttribute('aria-valuenow', '6');
  });
});
