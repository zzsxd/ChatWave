export {};

declare global {
  interface Window {
    ChatWaveAndroid?: {
      setCallActive(active: boolean): void;
    };
  }
}
