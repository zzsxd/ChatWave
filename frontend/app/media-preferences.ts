"use client";

export type MediaDevicePreferences = {
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;
};

const STORAGE_KEY = "chatwave-media-device-preferences";
export const MEDIA_PREFERENCES_EVENT = "chatwave:media-preferences";

const defaults: MediaDevicePreferences = {
  audioInputId: "",
  videoInputId: "",
  audioOutputId: "",
};

export function getMediaDevicePreferences(): MediaDevicePreferences {
  if (typeof window === "undefined") return defaults;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      audioInputId:
        typeof saved.audioInputId === "string" ? saved.audioInputId : "",
      videoInputId:
        typeof saved.videoInputId === "string" ? saved.videoInputId : "",
      audioOutputId:
        typeof saved.audioOutputId === "string" ? saved.audioOutputId : "",
    };
  } catch {
    return defaults;
  }
}

export function saveMediaDevicePreferences(
  preferences: MediaDevicePreferences,
) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(
    new CustomEvent<MediaDevicePreferences>(MEDIA_PREFERENCES_EVENT, {
      detail: preferences,
    }),
  );
}

export function microphoneConstraintsFor(
  preferences = getMediaDevicePreferences(),
): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    ...(preferences.audioInputId
      ? { deviceId: { exact: preferences.audioInputId } }
      : {}),
  };
}

export function cameraConstraintsFor(
  preferences = getMediaDevicePreferences(),
): MediaTrackConstraints {
  return {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 60 },
    ...(preferences.videoInputId
      ? { deviceId: { exact: preferences.videoInputId } }
      : {}),
  };
}
