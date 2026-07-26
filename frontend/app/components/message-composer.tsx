"use client";

import {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
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

const COMPOSER_EMOJIS = [
  "😀",
  "😂",
  "🥰",
  "😍",
  "😎",
  "🤔",
  "🥳",
  "😴",
  "😭",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙏",
  "💪",
  "🤝",
  "❤️",
  "💙",
  "🔥",
  "✨",
  "🎉",
  "💯",
  "🚀",
  "👀",
  "✅",
  "❌",
  "💬",
  "📎",
  "🌊",
  "⚡",
];

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
  onSend: (value: string) => void;
  onFileSelected: (file: File) => void;
  onCancelEditing: () => void;
  onCancelReply: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
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
  onSend,
  onFileSelected,
  onCancelEditing,
  onCancelReply,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
}: MessageComposerProps) {
  const disabled = !chat.conversationId;
  const [emojiOpen, setEmojiOpen] = useState(false);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const composerFieldRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const nativeDraftRef = useRef(draft);

  useEffect(() => {
    if (!emojiOpen) return;
    const closePicker = (event: PointerEvent) => {
      if (composerFieldRef.current?.contains(event.target as Node)) {
        return;
      }
      setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, [emojiOpen]);

  useEffect(() => {
    if (disabled) return;
    const frame = requestAnimationFrame(() => composerInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [chat.id, disabled]);

  useEffect(() => {
    nativeDraftRef.current = draft;
    const input = composerInputRef.current;
    if (!input || composingRef.current || input.value === draft) return;

    const cursor = Math.min(input.selectionStart ?? draft.length, draft.length);
    input.value = draft;
    if (document.activeElement === input) {
      input.setSelectionRange(cursor, cursor);
    }
  }, [chat.id, draft]);

  const updateNativeDraft = (value: string) => {
    nativeDraftRef.current = value;
    onDraftChange(value);
  };

  const sendFromComposer = () => {
    setEmojiOpen(false);
    const value = composerInputRef.current?.value ?? nativeDraftRef.current;
    onSend(value);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const insertEmoji = (emoji: string) => {
    const input = composerInputRef.current;
    const currentDraft = input?.value ?? nativeDraftRef.current;
    const start = input?.selectionStart ?? currentDraft.length;
    const end = input?.selectionEnd ?? start;
    const nextDraft = `${currentDraft.slice(0, start)}${emoji}${currentDraft.slice(end)}`;
    if (input) input.value = nextDraft;
    updateNativeDraft(nextDraft);
    requestAnimationFrame(() => {
      input?.focus();
      const cursor = start + emoji.length;
      input?.setSelectionRange(cursor, cursor);
    });
  };

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
      <div
        className="composer"
        role="group"
        aria-label="Отправка сообщения"
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
          className={`composer-file-button ${uploadingFile ? "uploading" : ""}`}
          disabled={uploadingFile || disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={20} />
        </button>
        <div ref={composerFieldRef} className="composer-field">
          <input
            ref={composerInputRef}
            defaultValue={draft}
            onInput={(event: FormEvent<HTMLInputElement>) => {
              updateNativeDraft(event.currentTarget.value);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              updateNativeDraft(event.currentTarget.value);
            }}
            onPaste={pasteImage}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (
                event.key !== "Enter" ||
                event.nativeEvent.isComposing ||
                event.repeat
              ) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              sendFromComposer();
            }}
            aria-label="Новое сообщение"
            disabled={disabled}
            autoCapitalize="sentences"
            autoComplete="off"
            autoCorrect="on"
            enterKeyHint="send"
            spellCheck
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
              className="composer-paperclip-button"
              aria-label="Прикрепить файл"
              disabled={uploadingFile || disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={18} />
            </button>
            <button
              type="button"
              className={`composer-emoji-button ${emojiOpen ? "active" : ""}`}
              aria-label="Эмодзи"
              aria-expanded={emojiOpen}
              disabled={disabled}
              onClick={() => setEmojiOpen((current) => !current)}
            >
              <Smile size={18} />
            </button>
          </span>
          {emojiOpen && (
            <div
              ref={emojiPickerRef}
              className="composer-emoji-picker"
              role="dialog"
              aria-label="Выбор эмодзи"
            >
              <div>
                <strong>Эмодзи</strong>
                <small>Добавьте настроение</small>
              </div>
              <span>
                {COMPOSER_EMOJIS.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => insertEmoji(emoji)}
                    aria-label={`Вставить ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </span>
            </div>
          )}
        </div>
        {recordingVoice && (
          <button
            type="button"
            className="cancel-recording"
            aria-label="Отменить голосовое сообщение"
            title="Отменить запись"
            onClick={onCancelRecording}
          >
            <X size={18} />
          </button>
        )}
        {draft.trim() ? (
          <button
            className="send-button"
            type="button"
            aria-label="Отправить"
            disabled={disabled}
            onClick={() => {
              sendFromComposer();
            }}
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
      </div>
    </>
  );
}
