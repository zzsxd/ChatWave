"use client";

import { useEffect, useRef, useState } from "react";

type UseVoiceRecorderOptions = {
  onRecorded: (file: File) => void;
  onError: (message: string) => void;
};

export function useVoiceRecorder({
  onRecorded,
  onError,
}: UseVoiceRecorderOptions) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const onRecordedRef = useRef(onRecorded);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
    onErrorRef.current = onError;
  }, [onError, onRecorded]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recorderRef.current) {
        recorderRef.current.onstop = null;
        if (recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const stop = () => {
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      streamRef.current = stream;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const extension = blob.type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-message.${extension}`, {
          type: blob.type,
        });
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        setSeconds(0);
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (file.size) onRecordedRef.current(file);
      };

      recorderRef.current = recorder;
      recorder.start(500);
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(
        () => setSeconds((value) => value + 1),
        1_000,
      );
    } catch {
      onErrorRef.current(
        "Нет доступа к микрофону или запись не поддерживается.",
      );
    }
  };

  return { recording, seconds, start, stop };
}
