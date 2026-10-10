import { describe, expect, it } from 'vitest';
import { errorCodeOf } from '@shared/api';
import { toErrorMessage, unwrapResult, wrapHandler } from './ipcResult';

describe('ipc result envelope', () => {
  it('wraps values', async () => {
    const h = wrapHandler(async (a: number, b: number) => a + b);
    expect(await h(1, 2)).toEqual({ ok: true, value: 3 });
    const sync = wrapHandler(() => 'x');
    expect(await sync()).toEqual({ ok: true, value: 'x' });
  });

  it('wraps engine errors keeping the code', async () => {
    const h = wrapHandler(async () => {
      throw new Error('ERR_DECODE_FAILED: bad header');
    });
    const r = await h();
    expect(r).toEqual({ ok: false, error: 'ERR_DECODE_FAILED: bad header' });
    expect(() => unwrapResult(r)).toThrow('ERR_DECODE_FAILED: bad header');
    try {
      unwrapResult(r);
    } catch (e) {
      expect(errorCodeOf(e)).toBe('ERR_DECODE_FAILED');
    }
  });

  it('prefixes unknown errors', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('ERR_UNKNOWN: boom');
    expect(toErrorMessage('ERR_IO: x')).toBe('ERR_IO: x');
    expect(toErrorMessage(42)).toBe('ERR_UNKNOWN: 42');
    expect(toErrorMessage(new Error('ERR_EMPTY_PROJECT'))).toBe('ERR_EMPTY_PROJECT');
  });

  it('rejects malformed responses', () => {
    expect(() => unwrapResult(undefined)).toThrow(/^ERR_UNKNOWN/);
    expect(() => unwrapResult({} as never)).toThrow(/^ERR_UNKNOWN/);
    expect(unwrapResult({ ok: true, value: undefined })).toBeUndefined();
  });
});
