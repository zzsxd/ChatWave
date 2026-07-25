"use client";

import { ClipboardEvent, FormEvent, RefObject } from "react";
import {
  Gift,
  MessageCircleMore,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Smile,
  Square,
  X,
} from "lucide-react";
import { Chat, Message } from "../models";

type MessageComposerProps = {
  chat: Chat;
  draft: string;
  editingMessage?: Message;
  replyingMessage?: Message;
  uploadingFile: boolean;
  recordingVoice: boolean;
  recordingSeconds: number;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onFileSelected: (file: File) => void;
  onCancelEditing: () => void;
  onCancelReply: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
};

export function MessageComposer({
  chat,
  draft,
  editingMessage,
  replyingMessage,
  uploadingFile,
  recordingVoice,
  recordingSeconds,
  fileInputRef,
  onDraftChange,
  onSubmit,
  onFileSelected,
  onCancelEditing,
  onCancelReply,
  onStartRecording,
  onStopRecording,
}: MessageComposerProps) {
  const disabled = !chat.conversationId;
  const pasteImage = (event: ClipboardEvent<HTMLInputElement>) => {
    if (disabled || uploadingFile) return;
    const imageItem = Array.from(event.clipboardData.items).find(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
    const clipboardFile = imageItem?.getAsFile();
    if (!clipboardFile) return;

    event.preventDefault();
    const extension =
      clipboardFile.type.split("/", 2)[1]?.replace("jpeg", "jpg") || "png";
    const fileName =
      clipboardFile.name && clipboardFile.name !== "image.png"
        ? clipboardFile.name
        : `chatwave-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
    onFileSelected(
      new File([clipboardFile], fileName, {
        type: clipboardFile.type,
        lastModified: Date.now(),
      }),
    );
  };

  return (
    <>
      {editingMessage && (
        <div className="editing-banner">
          <Pencil size={14} />
          <span>
            <strong>Редактирование</strong>
            {editingMessage.text}
          </span>
          <button
            onClick={onCancelEditing}
            aria-label="Отменить редактирование"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {replyingMessage && !editingMessage && (
        <div className="editing-banner reply-banner">
          <MessageCircleMore size={14} />
          <span>
            <strong>Ответ для {replyingMessage.author}</strong>
            {replyingMessage.text || replyingMessage.attachment?.name}
          </span>
          <button onClick={onCancelReply} aria-label="Отменить ответ">
            <X size={16} />
          </button>
        </div>
      )}
      <form
        className="composer"
        noValidate
        onSubmit={(event) => {
          // Prevent the browser's native form navigation even if the async
          // message handler throws or is replaced while the component is live.
          event.preventDefault();
          event.stopPropagation();
          onSubmit(event);
        }}
      >
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFileSelected(file);
          }}
        />
        <button
          type="button"
          aria-label="Добавить файл"
          className={uploadingFile ? "uploading" : ""}
          disabled={uploadingFile || disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={20} />
        </button>
        <div className="composer-field">
          <input
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onPaste={pasteImage}
            aria-label="Новое сообщение"
            disabled={disabled}
            placeholder={
              disabled
                ? "Создайте чат, чтобы отправить сообщение"
                : editingMessage
                  ? "Измените сообщение"
                  : replyingMessage
                    ? `Ответ для ${replyingMessage.author}`
                    : `Сообщение в ${chat.title}`
            }
          />
          <span>
            <button
              type="button"
              aria-label="Прикрепить файл"
              disabled={uploadingFile || disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={18} />
            </button>
            <button type="button" aria-label="Подарок" disabled={disabled}>
              <Gift size={18} />
            </button>
            <button type="button" aria-label="Эмодзи" disabled={disabled}>
              <Smile size={18} />
            </button>
          </span>
        </div>
        {draft.trim() ? (
          <button
            className="send-button"
            type="submit"
            aria-label="Отправить"
            disabled={disabled}
          >
            <Send size={18} />
          </button>
        ) : (
          <button
            type="button"
            aria-label={
              recordingVoice ? "Остановить запись" : "Голосовое сообщение"
            }
            className={recordingVoice ? "recording" : ""}
            disabled={disabled}
            onClick={recordingVoice ? onStopRecording : onStartRecording}
          >
            {recordingVoice ? <Square size={17} /> : <Mic size={19} />}
            {recordingVoice && (
              <small>
                {Math.floor(recordingSeconds / 60)}:
                {String(recordingSeconds % 60).padStart(2, "0")}
              </small>
            )}
          </button>
        )}
      </form>
    </>
  );
}
