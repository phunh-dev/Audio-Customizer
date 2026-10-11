/** IPC channel names shared by main and preload. */
export const IPC = {
  openFilesDialog: 'dialog:openFiles',
  openFolderDialog: 'dialog:openFolder',
  expandPaths: 'fs:expandPaths',
  loadSource: 'audio:loadSource',
  unloadSource: 'audio:unloadSource',
  sourcePeaks: 'audio:sourcePeaks',
  render: 'audio:render',
  estimateSize: 'audio:estimateSize',
  exportAudio: 'audio:export',
  releaseSession: 'audio:releaseSession',
  play: 'transport:play',
  pause: 'transport:pause',
  stop: 'transport:stop',
  seek: 'transport:seek',
  setLoop: 'transport:setLoop',
  getTransport: 'transport:get',
} as const;

export type IpcName = keyof typeof IPC;

/** main -> renderer push of TransportState */
export const TRANSPORT_EVENT = 'transport:state';
