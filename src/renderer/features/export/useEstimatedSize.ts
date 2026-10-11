import { useEffect, useState } from 'react';
import type { ExportOptions, Project } from '@shared/types';
import { errorCodeOf, type ErrorCode } from '@shared/api';
import { getApi } from '@renderer/api';

export const ESTIMATE_DEBOUNCE_MS = 350;

export interface EstimateState {
  bytes: number | null;
  loading: boolean;
  error: ErrorCode | null;
}

/**
 * Debounced `api.estimateSize`. Returns null bytes while there is nothing to
 * estimate (empty project, disabled) and keeps the previous value while a new
 * estimate is loading. Stale responses are ignored.
 */
export function useEstimatedSize(
  sessionId: string,
  project: Project,
  options: ExportOptions | null,
  enabled = true,
  delay = ESTIMATE_DEBOUNCE_MS,
): EstimateState {
  const [state, setState] = useState<EstimateState>({ bytes: null, loading: false, error: null });
  const active = enabled && options !== null && project.tracks.length > 0;
  const key = active ? JSON.stringify([sessionId, project, options]) : '';

  useEffect(() => {
    if (!active || !options) {
      setState({ bytes: null, loading: false, error: null });
      return;
    }
    let canceled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(() => {
      getApi()
        .estimateSize(sessionId, project, options)
        .then((bytes) => {
          if (!canceled) setState({ bytes, loading: false, error: null });
        })
        .catch((err: unknown) => {
          if (!canceled) setState({ bytes: null, loading: false, error: errorCodeOf(err) });
        });
    }, delay);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
    // `key` captures every input that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay]);

  return state;
}
