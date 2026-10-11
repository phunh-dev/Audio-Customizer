import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Fader } from '../Fader';
import '../testUtils';

function F(props: { onSelect?: () => void; onCommit?: (v: number) => void }) {
  const [v, setV] = useState(0);
  return (
    <Fader
      aria-label="Gain at 1 kHz"
      label="1k"
      unit="dB"
      min={-18}
      max={18}
      step={0.1}
      origin={0}
      defaultValue={0}
      value={v}
      onChange={setV}
      onCommit={props.onCommit}
      onSelect={props.onSelect}
    />
  );
}

describe('Fader', () => {
  it('renders a vertical slider with caption and read-out', () => {
    render(<F />);
    const s = screen.getByRole('slider', { name: 'Gain at 1 kHz' });
    expect(s).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.getByText('1k')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
  });

  it('keyboard: ArrowUp / End clamps at +18 dB; double-click resets', () => {
    const onCommit = vi.fn();
    render(<F onCommit={onCommit} />);
    const s = screen.getByRole('slider', { name: 'Gain at 1 kHz' });
    fireEvent.keyDown(s, { key: 'ArrowUp' });
    expect(s).toHaveAttribute('aria-valuenow', '0.1');
    fireEvent.keyDown(s, { key: 'End' });
    expect(s).toHaveAttribute('aria-valuenow', '18');
    expect(s).toHaveAttribute('aria-valuetext', '18.0 dB');
    fireEvent.doubleClick(s);
    expect(s).toHaveAttribute('aria-valuenow', '0');
    expect(onCommit).toHaveBeenLastCalledWith(0);
  });

  it('focusing selects the band', () => {
    const onSelect = vi.fn();
    render(<F onSelect={onSelect} />);
    fireEvent.focus(screen.getByRole('slider', { name: 'Gain at 1 kHz' }));
    expect(onSelect).toHaveBeenCalled();
  });
});
