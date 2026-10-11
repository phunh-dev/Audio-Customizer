import { describe, expect, it } from 'vitest';
import { defaultFormat, dragPosition, dragValue, normalizeValue, nudge, parseNumberInput } from '../valueMath';

const lin = { min: -10, max: 10, step: 0.5 };
const log = { min: 20, max: 20000, step: 1, scale: 'log' as const };

describe('valueMath', () => {
  it('normalizeValue clamps and snaps to the step grid', () => {
    expect(normalizeValue(3.3, lin)).toBe(3.5);
    expect(normalizeValue(99, lin)).toBe(10);
    expect(normalizeValue(-99, lin)).toBe(-10);
    expect(normalizeValue(0.1 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  });

  it('nudge steps linearly (x10 large) and clamps', () => {
    expect(nudge(0, 1, lin)).toBe(0.5);
    expect(nudge(0, -1, lin, { large: true })).toBe(-5);
    expect(nudge(9.5, 1, lin, { large: true })).toBe(10);
  });

  it('nudge moves log ranges by position', () => {
    const up = nudge(1000, 1, log);
    expect(up / 1000).toBeCloseTo(Math.pow(1000, 0.01), 2);
    expect(nudge(1000, -1, log, { fine: true })).toBeLessThan(1000);
    expect(nudge(1000, 1, log, { large: true })).toBeCloseTo(1000 * Math.pow(1000, 0.1), -1);
    expect(nudge(20000, 1, log)).toBe(20000);
  });

  it('nudge always progresses for coarse steps on a log scale', () => {
    expect(nudge(21, 1, { min: 20, max: 20000, step: 5, scale: 'log' })).toBeGreaterThan(21);
  });

  it('dragValue maps 200 px to the full range, fine = 10x slower', () => {
    expect(dragValue(-10, 200, lin)).toBe(10);
    expect(dragValue(0, 100, lin)).toBe(10);
    expect(dragValue(0, 100, lin, true)).toBe(1);
    expect(dragValue(0, -500, lin)).toBe(-10);
    expect(dragPosition(0.5, 20)).toBeCloseTo(0.6);
    expect(dragPosition(0.5, 20, true)).toBeCloseTo(0.51);
    expect(dragPosition(0.99, 100)).toBe(1);
  });

  it('defaultFormat derives decimals from the step', () => {
    expect(defaultFormat(1.234, 0.1)).toBe('1.2');
    expect(defaultFormat(5, 1, 'ms')).toBe('5 ms');
    expect(defaultFormat(-0.01, 0.1)).toBe('0.0');
  });

  it('parseNumberInput accepts comma decimals, units and k suffix', () => {
    expect(parseNumberInput('12.5')).toBe(12.5);
    expect(parseNumberInput(' -3,5 dB')).toBe(-3.5);
    expect(parseNumberInput('2.5k')).toBe(2500);
    expect(parseNumberInput('+6')).toBe(6);
    expect(parseNumberInput('.5')).toBe(0.5);
    expect(parseNumberInput('abc')).toBeNull();
    expect(parseNumberInput('')).toBeNull();
  });
});
