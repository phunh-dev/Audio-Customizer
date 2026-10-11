import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { logFrequencies } from '@renderer/lib/dsp/scale';
import { dbToY, ResponseCurve } from './ResponseCurve';

type CallLog = { __calls: string[] };

describe('ResponseCurve', () => {
  it('maps dB to y within the plot (clamped)', () => {
    expect(dbToY(0, 24, 0, 100)).toBe(50);
    expect(dbToY(24, 24, 0, 100)).toBe(0);
    expect(dbToY(-24, 24, 4, 100)).toBe(104);
    expect(dbToY(99, 24, 0, 100)).toBe(0);
  });

  it('draws grid, spectrum, curves and markers on a labelled canvas', () => {
    const freqs = logFrequencies(32);
    render(
      <ResponseCurve
        aria-label="Response"
        freqs={freqs}
        curves={[{ values: freqs.map(() => 3), fill: true }, { values: freqs.map(() => -3), dashed: true, color: '#fff' }]}
        spectrum={new Float32Array(64).fill(-30)}
        markers={[{ freq: 1000, db: 3, active: true }, { freq: 100, db: 0 }]}
      />,
    );
    const canvas = screen.getByRole('img', { name: 'Response' }) as HTMLCanvasElement;
    const calls = (canvas.getContext('2d') as unknown as CallLog).__calls;
    expect(calls.filter((c) => c.startsWith('stroke(')).length).toBeGreaterThan(10);
    expect(calls.filter((c) => c.startsWith('arc(')).length).toBe(2);
    expect(calls.filter((c) => c.startsWith('fill(')).length).toBeGreaterThanOrEqual(4);
  });

  it('skips curves whose length does not match the frequencies', () => {
    render(<ResponseCurve aria-label="Bad" freqs={[100, 1000]} curves={[{ values: [1] }]} bypassed />);
    const canvas = screen.getByRole('img', { name: 'Bad' }) as HTMLCanvasElement;
    const calls = (canvas.getContext('2d') as unknown as CallLog).__calls;
    expect(calls.filter((c) => c.startsWith('arc(')).length).toBe(0);
  });
});
