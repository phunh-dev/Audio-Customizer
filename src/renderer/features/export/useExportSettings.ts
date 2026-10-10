import { useCallback, useMemo } from 'react';
import type { ExportOptions } from '@shared/types';
import { selectActiveTab, useAppStore } from '@renderer/store';
import { projectFormat, sanitizeExportOptions, sourceBytes, type ProjectFormat } from './exportOptions';

export interface ExportSettings {
  sessionId: string;
  options: ExportOptions;
  /** Store sanitised options in the tab (and in the preview when it is on). */
  setOptions: (options: ExportOptions) => void;
  previewOn: boolean;
  setPreviewOn: (on: boolean) => void;
  format: ProjectFormat;
  sourceBytes: number;
}

/** Export settings of the active tab (shared by the Optimize panel and the Export dialog). */
export function useExportSettings(): ExportSettings {
  const sessionId = useAppStore((s) => s.activeTabId);
  const options = useAppStore((s) => selectActiveTab(s).exportOptions);
  const previewOn = useAppStore((s) => selectActiveTab(s).previewExport !== null);
  const tracks = useAppStore((s) => selectActiveTab(s).project.tracks);
  const sources = useAppStore((s) => s.sources);
  const format = useMemo(() => projectFormat(tracks, sources), [tracks, sources]);
  const bytes = useMemo(() => sourceBytes(tracks, sources), [tracks, sources]);

  const setOptions = useCallback(
    (next: ExportOptions) => {
      const st = useAppStore.getState();
      const clean = sanitizeExportOptions(next, format.sampleRate, format.channels);
      st.setExportOptions(clean);
      if (selectActiveTab(st).previewExport !== null) st.setPreviewExport(clean);
    },
    [format.sampleRate, format.channels],
  );

  const setPreviewOn = useCallback((on: boolean) => {
    const st = useAppStore.getState();
    st.setPreviewExport(on ? selectActiveTab(st).exportOptions : null);
  }, []);

  return { sessionId, options, setOptions, previewOn, setPreviewOn, format, sourceBytes: bytes };
}
