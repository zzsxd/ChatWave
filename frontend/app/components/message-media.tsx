"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  AudioLines,
  FileText,
  Maximize2,
  RefreshCw,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { chatWaveApi } from "../api";
import { Message } from "../models";

type LoadState = "idle" | "loading" | "ready" | "error";

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
      const blob = await chatWaveApi.downloadMedia(message.id);
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

  return (
    <div
      ref={mediaContainer}
      className={`inline-media audio-message ${
        mediaType === "voice" ? "voice-message" : ""
      }`}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="audio-message-icon">
        {mediaType === "voice" ? <Volume2 size={20} /> : <AudioLines size={20} />}
      </span>
      <div>
        <span className="audio-title">
          <strong>
            {mediaType === "voice"
              ? "Голосовое сообщение"
              : message.attachment.name}
          </strong>
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
