import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  deviceId: () => Promise<string>;
  appVersion: () => Promise<string>;
  minimizeWindow: () => void;
  onQueueUpdate: (callback: (count: number) => void) => void;
  removeQueueListener: () => void;
  openTikTokAuth: (authUrl: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
}

const MAX_CLIPBOARD_TEXT_LENGTH = 20_000;

function copyText(text: string): Promise<void> {
  if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    return Promise.reject(new Error('Clipboard text is invalid or too long'));
  }
  return ipcRenderer.invoke('clipboard:copy-text', text);
}

const api: ElectronAPI = {
  deviceId: () => ipcRenderer.invoke('device:get-id'),
  appVersion: () => ipcRenderer.invoke('app:get-version'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  onQueueUpdate: (callback) => ipcRenderer.on('queue:update', (_event, count) => callback(count)),
  removeQueueListener: () => ipcRenderer.removeAllListeners('queue:update'),
  openTikTokAuth: (authUrl: string) => ipcRenderer.invoke('tiktok:open-auth', authUrl),
  copyText,
};

contextBridge.exposeInMainWorld('electronAPI', api);

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
