type ChatWaveDesktopScreenSource = {
  id: string;
  kind: "window" | "screen";
  name: string;
  displayId: string;
  thumbnail: string;
  appIcon: string | null;
};

type ChatWaveDesktopSettings = {
  closeToTray: boolean;
  zoomFactor: number;
};

type ChatWaveDesktopUpdateState = {
  status:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";
  currentVersion: string;
  availableVersion: string | null;
  progress: number;
  error: string | null;
};

interface Window {
  chatWaveDesktop?: {
    platform: string;
    supportsSystemAudio: boolean;
    getScreenSources(): Promise<ChatWaveDesktopScreenSource[]>;
    selectScreenSource(sourceId: string, withAudio: boolean): Promise<void>;
    cancelScreenSource(): Promise<void>;
    getDesktopSettings(): Promise<ChatWaveDesktopSettings>;
    updateDesktopSettings(
      changes: Partial<ChatWaveDesktopSettings>,
    ): Promise<ChatWaveDesktopSettings>;
    getUpdateStatus?(): Promise<ChatWaveDesktopUpdateState>;
    checkForUpdates?(): Promise<ChatWaveDesktopUpdateState>;
    downloadUpdate?(): Promise<ChatWaveDesktopUpdateState>;
    installUpdate?(): Promise<void>;
    onUpdateState?(
      callback: (state: ChatWaveDesktopUpdateState) => void,
    ): () => void;
  };
}
