"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  AudioLines,
  Captions,
  FileText,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Video,
  X,
} from "lucide-react";
import { chatWaveApi } from "../api";
import { Message } from "../models";

type LoadState = "idle" | "loading" | "ready" | "error";

const mediaBlobCache = new Map<number, Blob>();
const pendingMediaLoads = new Map<number, Promise<Blob>>();
const MAX_CACHED_MEDIA_ITEMS = 24;
const MAX_CACHED_MEDIA_BYTES = 8 * 1024 * 1024;

async function loadMediaBlob(messageId: number, cacheable: boolean) {
  const cached = cacheable ? mediaBlobCache.get(messageId) : undefined;
  if (cached) {
    mediaBlobCache.delete(messageId);
    mediaBlobCache.set(messageId, cached);
    return cached;
  }
  const pending = pendingMediaLoads.get(messageId);
  if (pending) return pending;
  const request = chatWaveApi.downloadMedia(messageId);
  pendingMediaLoads.set(messageId, request);
  try {
    const blob = await request;
    if (cacheable && blob.size <= MAX_CACHED_MEDIA_BYTES) {
      mediaBlobCache.set(messageId, blob);
      while (mediaBlobCache.size > MAX_CACHED_MEDIA_ITEMS) {
        const oldest = mediaBlobCache.keys().next().value;
        if (typeof oldest !== "number") break;
        mediaBlobCache.delete(oldest);
      }
    }
    return blob;
  } finally {
    pendingMediaLoads.delete(messageId);
  }
}

const formatPlaybackTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

function VoiceMessagePlayer({
  messageId,
  source,
  onDownload,
}: {
  messageId: number;
  source: string;
  onDownload: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );
  const [transcribing, setTranscribing] = useState(false);
  const waveform = useMemo(
    () =>
      Array.from({ length: 38 }, (_, index) => {
        const primary = Math.abs(Math.sin(index * 1.67)) * 16;
        const secondary = Math.abs(Math.cos(index * 0.73)) * 8;
        return Math.round(5 + primary + secondary);
      }),
    [],
  );
  const progress = duration > 0 ? currentTime / duration : 0;

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  };

  const cycleSpeed = () => {
    const nextSpeed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(nextSpeed);
    if (audioRef.current) audioRef.current.playbackRate = nextSpeed;
  };

  const transcribe = async () => {
    if (transcribing) return;
    setTranscribing(true);
    setTranscriptionError(null);
    try {
      const result = await chatWaveApi.transcribeVoice(messageId);
      setTranscript(result.text);
    } catch (error) {
      setTranscriptionError(
        error instanceof Error ? error.message : "Не удалось расшифровать",
      );
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <div className="voice-message-shell">
      <div className="voice-player">
        <audio
          ref={audioRef}
          src={source}
          preload="metadata"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrentTime(0);
          }}
        />
        <button
          className="voice-play-button"
          onClick={() => void togglePlayback()}
          aria-label={playing ? "Пауза" : "Воспроизвести голосовое сообщение"}
        >
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <div className="voice-player-content">
          <div className="voice-waveform" aria-hidden="true">
            {waveform.map((height, index) => (
              <i
                key={index}
                className={index / waveform.length <= progress ? "played" : ""}
                style={{ height }}
              />
            ))}
            <input
              type="range"
              min="0"
              max={duration || 0}
              step="0.01"
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => {
                const nextTime = Number(event.target.value);
                setCurrentTime(nextTime);
                if (audioRef.current) audioRef.current.currentTime = nextTime;
              }}
              aria-label="Перемотать голосовое сообщение"
            />
          </div>
          <div className="voice-player-meta">
            <span>
              {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
            </span>
            <small>{playing ? "Воспроизводится" : "Голосовое сообщение"}</small>
          </div>
        </div>
        <button
          className="voice-speed"
          onClick={cycleSpeed}
          aria-label={`Скорость воспроизведения ${speed}x`}
        >
          {speed}×
        </button>
        <button
          className="audio-download"
          onClick={onDownload}
          aria-label="Скачать голосовое сообщение"
          title="Скачать"
        >
          <Download size={15} />
        </button>
      </div>
      {transcript ? (
        <div className="voice-transcript">
          <Captions size={15} />
          <p>{transcript}</p>
        </div>
      ) : (
        <button
          className={`voice-transcribe ${transcriptionError ? "error" : ""}`}
          onClick={() => void transcribe()}
          disabled={transcribing}
          title="Аудио будет обработано на сервере ChatWave"
        >
          {transcribing ? <RefreshCw className="spin" size={14} /> : <Captions size={14} />}
          <span>
            {transcribing
              ? "Расшифровываем…"
              : transcriptionError ?? "Расшифровать"}
          </span>
        </button>
      )}
    </div>
  );
}

export function MessageMedia({
  message,
  connected,
  onDownload,
}: {
  message: Message;
  connected: boolean;
  onDownload: () => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const mediaStage = useRef<HTMLDivElement>(null);
  const mediaContainer = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const activeRef = useRef(true);
  const mediaType = message.messageType;
  const previewable =
    mediaType === "image" ||
    mediaType === "video" ||
    mediaType === "audio" ||
    mediaType === "voice";

  const load = async () => {
    if (!previewable || message.id < 1 || !connected) return;
    setLoadState("loading");
    try {
      const blob = await loadMediaBlob(
        message.id,
        mediaType === "image" ||
          mediaType === "audio" ||
          mediaType === "voice",
      );
      const objectUrl = URL.createObjectURL(blob);
      if (!activeRef.current) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = objectUrl;
      setSource(objectUrl);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  };

  useEffect(() => {
    activeRef.current = true;
    if (previewable && message.id > 0 && connected) {
      const target = mediaContainer.current;
      if (!target || !("IntersectionObserver" in window)) {
        void load();
      } else {
        const observer = new IntersectionObserver(
          (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            void load();
          },
          { rootMargin: "500px 0px" },
        );
        observer.observe(target);
        return () => {
          activeRef.current = false;
          observer.disconnect();
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
          }
        };
      }
    }
    return () => {
      activeRef.current = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    // Reload only when the persisted message or its connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, message.id, previewable]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", close);
    };
  }, [lightboxOpen]);

  if (!message.attachment) return null;

  if (!previewable) {
    return (
      <button
        className="attachment"
        onClick={onDownload}
        disabled={!connected || message.id < 1}
      >
        <span>
          <FileText size={20} />
        </span>
        <div>
          <strong>{message.attachment.name}</strong>
          <small>{message.attachment.size} · Файл</small>
        </div>
        <Download size={17} />
      </button>
    );
  }

  if (loadState === "loading" || loadState === "idle") {
    return (
      <div
        ref={mediaContainer}
        className={`inline-media inline-media-loading media-${mediaType}`}
      >
        <span className="media-loader" />
        <strong>Загружаем {mediaType === "image" ? "изображение" : "медиа"}…</strong>
        <small>
          {message.attachment.name} · {message.attachment.size}
        </small>
      </div>
    );
  }

  if (loadState === "error" || !source) {
    return (
      <div ref={mediaContainer} className="inline-media inline-media-error">
        <FileText size={22} />
        <div>
          <strong>Не удалось открыть вложение</strong>
          <small>{message.attachment.name}</small>
        </div>
        <button onClick={() => void load()} disabled={!connected}>
          <RefreshCw size={15} /> Повторить
        </button>
      </div>
    );
  }

  if (mediaType === "image") {
    return (
      <>
        <div
          ref={mediaContainer}
          className="inline-media image-message"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="image-preview-button"
            onClick={() => setLightboxOpen(true)}
            aria-label="Открыть изображение"
          >
            <img src={source} alt={message.text || message.attachment.name} />
            <span>
              <Maximize2 size={17} /> Открыть
            </span>
          </button>
          <button
            className="media-download-button"
            onClick={onDownload}
            aria-label="Скачать изображение"
            title="Скачать"
          >
            <Download size={16} />
          </button>
        </div>
        {lightboxOpen &&
          createPortal(
            <div
              className="media-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label="Просмотр изображения"
              onMouseDown={() => setLightboxOpen(false)}
            >
              <div
                ref={mediaStage}
                className="media-lightbox-stage"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <img
                  src={source}
                  alt={message.text || message.attachment.name}
                />
                <div className="media-lightbox-actions">
                  <button
                    onClick={() => void mediaStage.current?.requestFullscreen()}
                    aria-label="Открыть на весь экран"
                    title="На весь экран"
                  >
                    <Maximize2 size={19} />
                  </button>
                  <button
                    onClick={onDownload}
                    aria-label="Скачать изображение"
                    title="Скачать"
                  >
                    <Download size={19} />
                  </button>
                  <button
                    onClick={() => setLightboxOpen(false)}
                    aria-label="Закрыть"
                    title="Закрыть"
                  >
                    <X size={20} />
                  </button>
                </div>
                <span>{message.attachment.name}</span>
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  }

  if (mediaType === "video") {
    return (
      <div
        ref={mediaContainer}
        className="inline-media video-message"
        onClick={(event) => event.stopPropagation()}
      >
        <video src={source} controls playsInline preload="metadata" />
        <div className="inline-media-caption">
          <Video size={15} />
          <span>
            <strong>{message.attachment.name}</strong>
            <small>{message.attachment.size} · Видео</small>
          </span>
          <button onClick={onDownload} aria-label="Скачать видео">
            <Download size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (mediaType === "voice") {
    return (
      <div
        ref={mediaContainer}
        className="inline-media audio-message voice-message"
        onClick={(event) => event.stopPropagation()}
      >
        <VoiceMessagePlayer
          messageId={message.id}
          source={source}
          onDownload={onDownload}
        />
      </div>
    );
  }

  return (
    <div
      ref={mediaContainer}
      className="inline-media audio-message"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="audio-message-icon">
        <AudioLines size={20} />
      </span>
      <div>
        <span className="audio-title">
          <strong>{message.attachment.name}</strong>
          <small>{message.attachment.size}</small>
        </span>
        <audio src={source} controls preload="metadata" />
      </div>
      <button
        className="audio-download"
        onClick={onDownload}
        aria-label="Скачать аудио"
        title="Скачать"
      >
        <Download size={15} />
      </button>
    </div>
  );
}
