import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  deviceId: () => Promise<string>;
  appVersion: () => Promise<string>;
  minimizeWindow: () => void;
  onQueueUpdate: (callback: (count: number) => void) => void;
  removeQueueListener: () => void;
  openTikTokAuth: (authUrl: string) => Promise<void>;
}

const api: ElectronAPI = {
  deviceId: () => ipcRenderer.invoke('device:get-id'),
  appVersion: () => ipcRenderer.invoke('app:get-version'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  onQueueUpdate: (callback) => ipcRenderer.on('queue:update', (_event, count) => callback(count)),
  removeQueueListener: () => ipcRenderer.removeAllListeners('queue:update'),
  openTikTokAuth: (authUrl: string) => ipcRenderer.invoke('tiktok:open-auth', authUrl),
};

contextBridge.exposeInMainWorld('electronAPI', api);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
