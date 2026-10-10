/**
 * Error forwarding over IPC. `ipcMain.handle` rejections are rewrapped by
 * Electron ("Error invoking remote method ..."), which would hide the
 * `ERR_*` code; so handlers return an envelope and the preload re-throws
 * an `Error` whose message is exactly the engine message.
 */

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

const CODE_RE = /^ERR_[A-Z_]+/;

/** Message of anything thrown, guaranteed to start with an `ERR_*` code. */
export function toErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  return CODE_RE.test(msg) ? msg : `ERR_UNKNOWN: ${msg}`;
}

export function wrapHandler<A extends unknown[], R>(
  fn: (...args: A) => R | Promise<R>,
): (...args: A) => Promise<IpcResult<Awaited<R>>> {
  return async (...args: A) => {
    try {
      return { ok: true, value: (await fn(...args)) as Awaited<R> };
    } catch (e) {
      return { ok: false, error: toErrorMessage(e) };
    }
  };
}

/** Renderer side: turn an envelope back into a value or a thrown Error. */
export function unwrapResult<T>(r: IpcResult<T> | undefined | null): T {
  if (!r || typeof r !== 'object' || !('ok' in r)) {
    throw new Error('ERR_UNKNOWN: malformed IPC response');
  }
  if (r.ok) return r.value;
  throw new Error(r.error);
}
