/**
 * Export: the save dialog is shown FIRST; nothing is encoded or written
 * when it is canceled. `AUDIO_CUSTOMIZER_E2E_SAVE_PATH` bypasses the dialog
 * (E2E tests only).
 */
import { dirname, extname, join, posix } from 'node:path';
import type { ExportResult } from '@shared/api';
import type { ExportFormat, ExportOptions, Project } from '@shared/types';
import type { NativeEngine } from './native';

export const E2E_SAVE_PATH_ENV = 'AUDIO_CUSTOMIZER_E2E_SAVE_PATH';

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
  properties?: string[];
}

export interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

const FORMAT_FILTERS: Record<ExportFormat, FileFilter> = {
  wav: { name: 'WAV audio', extensions: ['wav'] },
  aiff: { name: 'AIFF audio', extensions: ['aiff', 'aif'] },
  flac: { name: 'FLAC audio', extensions: ['flac'] },
  mp3: { name: 'MP3 audio', extensions: ['mp3'] },
  ogg: { name: 'Ogg Vorbis audio', extensions: ['ogg'] },
};

export function filtersFor(format: ExportFormat): FileFilter[] {
  const f = FORMAT_FILTERS[format];
  if (!f) throw new Error(`ERR_INVALID_PARAM: format ${String(format)}`);
  return [f];
}

const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** `name` without directories / extension / invalid chars + format extension. */
export function suggestedFileName(name: string, format: ExportFormat): string {
  const ext = FORMAT_FILTERS[format]?.extensions[0] ?? format;
  let base = posix.basename(String(name ?? '').replace(/\\/g, '/'));
  const e = extname(base);
  if (e && /^\.[a-z0-9]{1,5}$/i.test(e)) base = base.slice(0, -e.length);
  base = base.replace(INVALID_CHARS, '_').replace(/[. ]+$/, '').trim();
  if (!base) base = 'export';
  return `${base}.${ext}`;
}

/** Append the format extension when the chosen path has none. */
export function ensureExtension(path: string, format: ExportFormat): string {
  if (extname(path)) return path;
  return `${path}.${FORMAT_FILTERS[format]?.extensions[0] ?? format}`;
}

export interface ExportDeps {
  engine: Pick<NativeEngine, 'export'>;
  showSaveDialog(opts: SaveDialogOptions): Promise<SaveDialogResult>;
  env: Record<string, string | undefined>;
  /** default folder for the dialog */
  defaultDir(): string;
}

export function createExporter(deps: ExportDeps) {
  let lastDir: string | null = null;
  return async function exportAudio(
    sessionId: string,
    project: Project,
    options: ExportOptions,
    suggestedName: string,
  ): Promise<ExportResult> {
    const format = options?.format;
    const filters = filtersFor(format);
    let path: string;
    const e2e = deps.env[E2E_SAVE_PATH_ENV];
    if (e2e) {
      path = e2e;
    } else {
      const res = await deps.showSaveDialog({
        defaultPath: join(lastDir ?? deps.defaultDir(), suggestedFileName(suggestedName, format)),
        filters,
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      path = ensureExtension(res.filePath, format);
      lastDir = dirname(path);
    }
    const bytes = await deps.engine.export(sessionId, JSON.stringify(project), JSON.stringify(options), path);
    return { canceled: false, path, bytes };
  };
}
