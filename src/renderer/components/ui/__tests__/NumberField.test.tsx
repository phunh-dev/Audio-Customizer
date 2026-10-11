import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NumberField } from '../NumberField';

function Field(props: { onCommit?: (v: number) => void; initial?: number }) {
  const [v, setV] = useState(props.initial ?? 0);
  return <NumberField aria-label="Gain" unit="dB" min={-60} max={24} step={0.1} value={v} onChange={setV} onCommit={props.onCommit} />;
}

describe('NumberField', () => {
  it('is a spinbutton with aria values and unit', () => {
    render(<Field initial={-3} />);
    const f = screen.getByRole('spinbutton', { name: 'Gain' });
    expect(f).toHaveAttribute('aria-valuenow', '-3');
    expect(f).toHaveAttribute('aria-valuemin', '-60');
    expect(f).toHaveAttribute('aria-valuemax', '24');
    expect(f).toHaveValue('-3.0');
    expect(screen.getByText('dB')).toBeInTheDocument();
  });

  it('commits typed values on Enter / blur with clamping and snapping', () => {
    const onCommit = vi.fn();
    render(<Field onCommit={onCommit} />);
    const f = screen.getByRole('spinbutton', { name: 'Gain' });
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: '100' } });
    fireEvent.keyDown(f, { key: 'Enter' });
    expect(onCommit).toHaveBeenLastCalledWith(24);
    expect(f).toHaveValue('24.0');
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: '-7,26' } });
    fireEvent.blur(f);
    expect(onCommit).toHaveBeenLastCalledWith(-7.3);
    expect(f).toHaveAttribute('aria-valuenow', '-7.3');
  });

  it('reverts on Escape and on garbage input', () => {
    const onCommit = vi.fn();
    render(<Field initial={2} onCommit={onCommit} />);
    const f = screen.getByRole('spinbutton', { name: 'Gain' });
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: '9' } });
    fireEvent.keyDown(f, { key: 'Escape' });
    expect(f).toHaveValue('2.0');
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: 'loud' } });
    fireEvent.keyDown(f, { key: 'Enter' });
    expect(f).toHaveValue('2.0');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('steps with arrow keys (Shift = x10)', () => {
    render(<Field />);
    const f = screen.getByRole('spinbutton', { name: 'Gain' });
    fireEvent.keyDown(f, { key: 'ArrowUp' });
    expect(f).toHaveAttribute('aria-valuenow', '0.1');
    fireEvent.keyDown(f, { key: 'ArrowDown', shiftKey: true });
    expect(f).toHaveAttribute('aria-valuenow', '-0.9');
  });
});
