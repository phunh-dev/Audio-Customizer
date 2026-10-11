/**
 * Implementation of the AudioApi (contract section 3) on the main side.
 * Pure: electron objects are injected so everything is unit testable.
 */
import type { ExportResult, RenderRequest, RenderResult, SourceInfo, TransportState } from '@shared/api';
import type { ExportOptions, Project } from '@shared/types';
import { SUPPORTED_EXTENSIONS } from '@shared/types';
import { IPC, type IpcName } from './channels';
import { createExporter, type SaveDialogOptions, type SaveDialogResult } from './exportFlow';
import { expandPaths } from './expandPaths';
import { wrapHandler } from './ipcResult';
import type { NativeEngine } from './native';

export interface OpenDialogOptions {
  title?: string;
  properties: string[];
  filters?: { name: string; extensions: string[] }[];
}

export interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export interface HandlerDeps {
  engine: NativeEngine;
  showOpenDialog(opts: OpenDialogOptions): Promise<OpenDialogResult>;
  showSaveDialog(opts: SaveDialogOptions): Promise<SaveDialogResult>;
  env: Record<string, string | undefined>;
  defaultDir(): string;
  /** transport (or what it plays) may have changed */
  onTransportChange(): void;
}

export interface MainApi {
  openFilesDialog(): Promise<string[]>;
  openFolderDialog(): Promise<string[]>;
  expandPaths(paths: string[]): Promise<string[]>;
  loadSource(path: string): Promise<SourceInfo>;
  unloadSource(id: string): Promise<void>;
  sourcePeaks(id: string, buckets: number): Promise<Float32Array>;
  render(req: RenderRequest): Promise<RenderResult>;
  estimateSize(sessionId: string, project: Project, options: ExportOptions): Promise<number>;
  exportAudio(sessionId: string, project: Project, options: ExportOptions, suggestedName: string): Promise<ExportResult>;
  releaseSession(sessionId: string): Promise<void>;
  play(sessionId: string): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setLoop(enabled: boolean): Promise<void>;
  getTransport(): Promise<TransportState>;
}

function invalid(what: string): never {
  throw new Error(`ERR_INVALID_PARAM: ${what}`);
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.length === 0) invalid(`${name} must be a non-empty string`);
  return v;
}

function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) invalid(`${name} must be a finite number`);
  return v;
}

function obj<T>(v: unknown, name: string): T {
  if (v === null || typeof v !== 'object') invalid(`${name} must be an object`);
  return v as T;
}

const AUDIO_FILTER = { name: 'Audio', extensions: [...SUPPORTED_EXTENSIONS] };

export function createMainApi(deps: HandlerDeps): MainApi {
  const { engine } = deps;
  const exporter = createExporter(deps);
  const changed = () => deps.onTransportChange();

  return {
    async openFilesDialog() {
      const r = await deps.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [AUDIO_FILTER] });
      return r.canceled ? [] : expandPaths(r.filePaths);
    },
    async openFolderDialog() {
      const r = await deps.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] });
      return r.canceled ? [] : expandPaths(r.filePaths);
    },
    async expandPaths(paths) {
      if (!Array.isArray(paths)) invalid('paths must be an array');
      return expandPaths(paths.filter((p): p is string => typeof p === 'string'));
    },
    loadSource: async (path) => engine.loadSource(str(path, 'path')),
    unloadSource: async (id) => engine.unloadSource(str(id, 'id')),
    sourcePeaks: async (id, buckets) => engine.sourcePeaks(str(id, 'id'), Math.max(1, Math.round(num(buckets, 'buckets')))),
    async render(req) {
      const r = obj<RenderRequest>(req, 'request');
      const result = await engine.render(
        str(r.sessionId, 'sessionId'),
        JSON.stringify(obj(r.project, 'project')),
        r.preview ? JSON.stringify(r.preview) : null,
        Math.max(1, Math.round(num(r.peaksBuckets, 'peaksBuckets'))),
        Math.max(1, Math.round(num(r.spectrogramWidth, 'spectrogramWidth'))),
        Math.max(1, Math.round(num(r.spectrogramHeight, 'spectrogramHeight'))),
      );
      changed();
      return result;
    },
    estimateSize: async (sessionId, project, options) =>
      engine.estimateSize(
        str(sessionId, 'sessionId'),
        JSON.stringify(obj(project, 'project')),
        JSON.stringify(obj(options, 'options')),
      ),
    async exportAudio(sessionId, project, options, suggestedName) {
      return exporter(
        str(sessionId, 'sessionId'),
        obj<Project>(project, 'project'),
        obj<ExportOptions>(options, 'options'),
        typeof suggestedName === 'string' ? suggestedName : 'export',
      );
    },
    async releaseSession(sessionId) {
      engine.releaseSession(str(sessionId, 'sessionId'));
      changed();
    },
    async play(sessionId) {
      engine.play(str(sessionId, 'sessionId'));
      changed();
    },
    async pause() {
      engine.pause();
      changed();
    },
    async stop() {
      engine.stop();
      changed();
    },
    async seek(seconds) {
      engine.seek(num(seconds, 'seconds'));
      changed();
    },
    async setLoop(enabled) {
      engine.setLoop(Boolean(enabled));
      changed();
    },
    getTransport: async () => engine.transportState(),
  };
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
  removeHandler?(channel: string): void;
}

/** Register every MainApi method under its IPC channel (result envelope). */
export function registerIpcHandlers(ipcMain: IpcMainLike, api: MainApi): string[] {
  const names = Object.keys(IPC) as IpcName[];
  for (const name of names) {
    const fn = api[name] as (...args: unknown[]) => Promise<unknown>;
    const wrapped = wrapHandler((...args: unknown[]) => fn(...args));
    ipcMain.handle(IPC[name], (_event, ...args: unknown[]) => wrapped(...args));
  }
  return names.map((n) => IPC[n]);
}
