/// <reference types="vite/client" />

interface ElectronAPI {
  deviceId: () => Promise<string>;
  appVersion: () => Promise<string>;
  minimizeWindow: () => void;
  onQueueUpdate: (callback: (count: number) => void) => void;
  removeQueueListener: () => void;
  openTikTokAuth: (authUrl: string) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
