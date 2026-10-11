import type { AudioApi } from '@shared/api';

/** The preload bridge (`window.api`). In a plain browser, main.tsx installs the mock first. */
export function getApi(): AudioApi {
  const api = (globalThis as { api?: AudioApi }).api ?? (typeof window !== 'undefined' ? window.api : undefined);
  if (!api) throw new Error('ERR_UNKNOWN: window.api is not available');
  return api;
}

export function hasApi(): boolean {
  return typeof window !== 'undefined' && window.api !== undefined;
}
