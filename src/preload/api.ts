/**
 * Builds the `window.api` object (AudioApi, contract section 3) on top of
 * ipcRenderer. Every call unwraps the main-side result envelope so promises
 * reject with an Error whose message starts with the `ERR_*` code.
 */
import type { AudioApi, TransportState } from '@shared/api';
import { IPC, TRANSPORT_EVENT } from '../main/channels';
import { unwrapResult, type IpcResult } from '../main/ipcResult';

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown;
}

export interface WebUtilsLike {
  getPathForFile(file: File): string;
}

export function createApi(ipc: IpcRendererLike, webUtils: WebUtilsLike): AudioApi {
  const call = async <T>(channel: string, ...args: unknown[]): Promise<T> =>
    unwrapResult((await ipc.invoke(channel, ...args)) as IpcResult<T>);

  return {
    openFilesDialog: () => call(IPC.openFilesDialog),
    openFolderDialog: () => call(IPC.openFolderDialog),
    expandPaths: (paths) => call(IPC.expandPaths, paths),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    loadSource: (path) => call(IPC.loadSource, path),
    unloadSource: (id) => call(IPC.unloadSource, id),
    sourcePeaks: (id, buckets) => call(IPC.sourcePeaks, id, buckets),
    render: (req) => call(IPC.render, req),
    estimateSize: (sessionId, project, options) => call(IPC.estimateSize, sessionId, project, options),
    exportAudio: (sessionId, project, options, suggestedName) =>
      call(IPC.exportAudio, sessionId, project, options, suggestedName),
    releaseSession: (sessionId) => call(IPC.releaseSession, sessionId),
    play: (sessionId) => call(IPC.play, sessionId),
    pause: () => call(IPC.pause),
    stop: () => call(IPC.stop),
    seek: (seconds) => call(IPC.seek, seconds),
    setLoop: (enabled) => call(IPC.setLoop, enabled),
    getTransport: () => call(IPC.getTransport),
    onTransport: (cb) => {
      const listener = (_event: unknown, state: TransportState) => cb(state);
      ipc.on(TRANSPORT_EVENT, listener);
      return () => {
        ipc.removeListener(TRANSPORT_EVENT, listener);
      };
    },
  };
}
