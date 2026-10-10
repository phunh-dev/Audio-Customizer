/**
 * In-memory AudioApi used by unit tests and installed in dev when the page runs
 * in a plain browser (no Electron preload). No Vitest imports here.
 */
import type {
  AudioApi,
  ExportResult,
  RenderRequest,
  RenderResult,
  SourceInfo,
  TransportState,
} from '@shared/api';
import { SUPPORTED_EXTENSIONS, type ExportOptions, type Project } from '@shared/types';
import { durationsOf } from '../store/appStore';
import { projectDuration } from '../utils/edit';

export interface MockCall {
  method: string;
  args: unknown[];
}

export interface MockApiOptions {
  /** duration in seconds for a given path (default: 2 s + 1 s per char of the base name mod 5) */
  durationOf?: (path: string) => number;
  /** paths rejected by loadSource with ERR_DECODE_FAILED */
  failPaths?: string[];
  /** simulate playback progress with real timers (dev) */
  simulatePlayback?: boolean;
}

export interface MockAudioApi extends AudioApi {
  calls: MockCall[];
  callsTo(method: string): unknown[][];
  /** files returned by the open dialogs / folder expansion */
  dialogFiles: string[];
  folderFiles: Record<string, string[]>;
  transport: TransportState;
  emitTransport(patch: Partial<TransportState>): void;
  listenerCount(): number;
  loaded: Set<string>;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

function extOf(p: string): string {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  return i >= 0 ? b.slice(i + 1).toLowerCase() : '';
}

export function createMockApi(opts: MockApiOptions = {}): MockAudioApi {
  const calls: MockCall[] = [];
  const listeners = new Set<(s: TransportState) => void>();
  const sources = new Map<string, SourceInfo>();
  const sessions = new Map<string, number>();
  const durationOf = opts.durationOf ?? ((p: string) => 2 + (baseName(p).length % 5));
  let timer: ReturnType<typeof setInterval> | null = null;

  const record = (method: string, args: unknown[]): void => {
    calls.push({ method, args });
  };

  const api: MockAudioApi = {
    calls,
    dialogFiles: [],
    folderFiles: {},
    loaded: new Set(),
    transport: { state: 'stopped', position: 0, duration: 0, sessionId: null, loop: false },

    callsTo(method) {
      return calls.filter((c) => c.method === method).map((c) => c.args);
    },

    emitTransport(patch) {
      api.transport = { ...api.transport, ...patch };
      for (const l of listeners) l({ ...api.transport });
    },

    listenerCount() {
      return listeners.size;
    },

    async openFilesDialog() {
      record('openFilesDialog', []);
      return [...api.dialogFiles];
    },

    async openFolderDialog() {
      record('openFolderDialog', []);
      return Object.values(api.folderFiles).flat();
    },

    async expandPaths(paths) {
      record('expandPaths', [paths]);
      const out = new Set<string>();
      for (const p of paths) {
        const inFolder = api.folderFiles[p];
        if (inFolder) inFolder.forEach((f) => out.add(f));
        else if (SUPPORTED_EXTENSIONS.includes(extOf(p))) out.add(p);
      }
      return [...out].sort();
    },

    getPathForFile(file) {
      record('getPathForFile', [file.name]);
      const withPath = file as File & { path?: string };
      return withPath.path ?? file.name;
    },

    async loadSource(path) {
      record('loadSource', [path]);
      if (opts.failPaths?.includes(path)) throw new Error(`ERR_DECODE_FAILED: cannot decode ${path}`);
      if (!SUPPORTED_EXTENSIONS.includes(extOf(path))) throw new Error(`ERR_UNSUPPORTED_FORMAT: ${path}`);
      const duration = durationOf(path);
      const sampleRate = 44100;
      const info: SourceInfo = {
        id: path,
        path,
        name: baseName(path),
        format: extOf(path),
        sampleRate,
        channels: 2,
        frames: Math.round(duration * sampleRate),
        duration,
        bitDepth: 16,
        fileSize: Math.round(duration * sampleRate * 4),
      };
      sources.set(path, info);
      api.loaded.add(path);
      return info;
    },

    async unloadSource(id) {
      record('unloadSource', [id]);
      api.loaded.delete(id);
    },

    async sourcePeaks(id, buckets) {
      record('sourcePeaks', [id, buckets]);
      const out = new Float32Array(buckets * 2);
      for (let i = 0; i < buckets; i++) {
        const a = 0.2 + 0.6 * Math.abs(Math.sin(i / 23)) * (0.6 + 0.4 * Math.sin(i / 3));
        out[i * 2] = -a;
        out[i * 2 + 1] = a;
      }
      return out;
    },

    async render(req: RenderRequest): Promise<RenderResult> {
      record('render', [req]);
      for (const t of req.project.tracks) {
        if (!api.loaded.has(t.sourceId)) throw new Error(`ERR_SOURCE_NOT_LOADED: ${t.sourceId}`);
      }
      if (req.project.tracks.length === 0) throw new Error('ERR_EMPTY_PROJECT');
      const durations = durationsOf(Object.fromEntries(sources));
      const duration = projectDuration(req.project.tracks, durations);
      sessions.set(req.sessionId, duration);
      const sampleRate = req.preview && req.preview.sampleRate > 0 ? req.preview.sampleRate : 44100;
      const n = req.peaksBuckets;
      const peaks = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const a = 0.15 + 0.7 * Math.abs(Math.sin(i / 31)) * (0.5 + 0.5 * Math.cos(i / 7));
        peaks[i * 2] = -a;
        peaks[i * 2 + 1] = a;
      }
      const w = req.spectrogramWidth;
      const h = req.spectrogramHeight;
      const data = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const base = (y / h) * 200;
          const wobble = 40 * Math.sin(x / 9 + y / 17);
          data[y * w + x] = Math.max(0, Math.min(255, Math.round(base + wobble)));
        }
      }
      return {
        duration,
        sampleRate,
        channels: req.preview?.channels === 'mono' ? 1 : 2,
        peaks,
        spectrogram: { width: w, height: h, data, minFreq: 20, maxFreq: sampleRate / 2, dbFloor: -100 },
        peakDb: -1.2,
        lufs: -14.3,
        averageSpectrum: new Float32Array(64).map((_, i) => -20 - i * 0.6),
      };
    },

    async estimateSize(sessionId: string, project: Project, options: ExportOptions) {
      record('estimateSize', [sessionId, project, options]);
      const duration = sessions.get(sessionId) ?? 0;
      const sr = options.sampleRate || 44100;
      const ch = options.channels === 'mono' ? 1 : 2;
      if (options.format === 'mp3' || options.format === 'ogg') return Math.round((duration * options.bitrateKbps * 1000) / 8);
      return Math.round(duration * sr * ch * (options.bitDepth / 8)) + 44;
    },

    async exportAudio(sessionId, project, options, suggestedName): Promise<ExportResult> {
      record('exportAudio', [sessionId, project, options, suggestedName]);
      return { canceled: true };
    },

    async releaseSession(sessionId) {
      record('releaseSession', [sessionId]);
      sessions.delete(sessionId);
    },

    async play(sessionId) {
      record('play', [sessionId]);
      const duration = sessions.get(sessionId) ?? 0;
      api.emitTransport({ state: 'playing', sessionId, duration });
      if (opts.simulatePlayback && !timer) {
        let last = Date.now();
        timer = setInterval(() => {
          const now = Date.now();
          let pos = api.transport.position + (now - last) / 1000;
          last = now;
          if (pos >= api.transport.duration) {
            if (api.transport.loop) pos = 0;
            else {
              if (timer) clearInterval(timer);
              timer = null;
              api.emitTransport({ state: 'stopped', position: 0 });
              return;
            }
          }
          api.emitTransport({ position: pos });
        }, 33);
      }
    },

    async pause() {
      record('pause', []);
      if (timer) clearInterval(timer);
      timer = null;
      api.emitTransport({ state: api.transport.state === 'playing' ? 'paused' : api.transport.state });
    },

    async stop() {
      record('stop', []);
      if (timer) clearInterval(timer);
      timer = null;
      api.emitTransport({ state: 'stopped', position: 0 });
    },

    async seek(seconds) {
      record('seek', [seconds]);
      api.emitTransport({ position: seconds });
    },

    async setLoop(enabled) {
      record('setLoop', [enabled]);
      api.emitTransport({ loop: enabled });
    },

    async getTransport() {
      record('getTransport', []);
      return { ...api.transport };
    },

    onTransport(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
  return api;
}

/** Install a mock as `window.api` (dev in a plain browser, tests). */
export function installMockApi(opts?: MockApiOptions): MockAudioApi {
  const api = createMockApi(opts);
  (window as unknown as { api: AudioApi }).api = api;
  return api;
}
