"use client";

import { CSSProperties } from "react";
import {
  Check,
  CheckCheck,
  LockKeyhole,
  MessageCircleMore,
  MoreHorizontal,
  Pencil,
  Pin,
  PhoneCall,
  RotateCcw,
  Smile,
  Trash2,
} from "lucide-react";
import { Chat, HistoryState, Message } from "../models";
import { MessageMedia } from "./message-media";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

type MessageFeedProps = {
  chat: Chat;
  messages: Message[];
  history?: HistoryState;
  typingUsers: string[];
  connected: boolean;
  selectionMode: boolean;
  selectedMessageIds: number[];
  reactionPickerFor: number | null;
  onLoadOlder: () => void;
  onOpenMessage: (message: Message) => void;
  onDownload: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onToggleReactionPicker: (messageId: number) => void;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message) => void;
  onRetry: (message: Message) => void;
  onPin: (message: Message) => void;
  onToggleSelection: (messageId: number) => void;
};

export function MessageFeed({
  chat,
  messages,
  history,
  typingUsers,
  connected,
  selectionMode,
  selectedMessageIds,
  reactionPickerFor,
  onLoadOlder,
  onOpenMessage,
  onDownload,
  onReact,
  onToggleReactionPicker,
  onReply,
  onEdit,
  onDelete,
  onRetry,
  onPin,
  onToggleSelection,
}: MessageFeedProps) {
  const selectedMessages = new Set(selectedMessageIds);
  return (
    <div className="messages-scroll">
      <div className="date-divider">
        <span>Сегодня</span>
      </div>

      {chat.conversationId && history?.hasMore && (
        <button
          className="load-history"
          onClick={onLoadOlder}
          disabled={history.loading}
        >
          {history.loading
            ? "Загружаем историю…"
            : "Показать более ранние сообщения"}
        </button>
      )}

      {messages.map((message, index) => {
        if (message.callEvent) {
          const minutes = Math.floor(message.callEvent.duration / 60);
          const seconds = message.callEvent.duration % 60;
          const duration =
            message.callEvent.duration > 0
              ? `${minutes}:${String(seconds).padStart(2, "0")}`
              : null;
          return (
            <article
              id={`message-${message.id}`}
              key={message.id}
              className={`call-history-event ${
                message.callEvent.outcome !== "completed" ? "missed" : ""
              }`}
              style={{ "--message-index": index } as CSSProperties}
            >
              <span>
                <PhoneCall size={18} />
              </span>
              <div>
                <strong>{message.text}</strong>
                <small>
                  {message.time}
                  {duration ? ` · ${duration}` : ""}
                </small>
              </div>
            </article>
          );
        }
        const replySource = message.replyToId
          ? messages.find((item) => item.id === message.replyToId)
          : undefined;
        return (
          <article
            id={`message-${message.id}`}
            key={message.id}
            className={`message ${message.own ? "own" : ""} ${
              message.pending ? "pending" : ""
            } ${message.failed ? "failed" : ""} ${
              selectedMessages.has(message.id) ? "selected" : ""
            } ${
              selectionMode && !message.pending && !message.failed
                ? "selectable"
                : ""
            }`}
            style={{ "--message-index": index } as CSSProperties}
            onClick={
              selectionMode &&
              !message.pending &&
              !message.failed
                ? () => onToggleSelection(message.id)
                : undefined
            }
          >
            {selectionMode && !message.pending && !message.failed && (
              <button
                className="message-select"
                aria-label={
                  selectedMessages.has(message.id)
                    ? "Снять выделение"
                    : "Выбрать сообщение"
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelection(message.id);
                }}
              >
                {selectedMessages.has(message.id) && <Check size={14} />}
              </button>
            )}
            <span className={`avatar avatar-${message.accent}`}>
              {message.avatarUrl ? (
                <img src={message.avatarUrl} alt="" />
              ) : (
                message.initials
              )}
            </span>
            <div className="message-body">
              <div className="message-meta">
                <strong>{message.author}</strong>
                <time>{message.time}</time>
                {message.pending && <small>отправляется</small>}
                {message.failed && <small>не отправлено</small>}
                {message.edited && <small>изменено</small>}
                {message.encrypted && (
                  <span
                    className="message-encrypted"
                    title="Текст защищён сквозным шифрованием"
                    aria-label="Сквозное шифрование"
                  >
                    <LockKeyhole size={11} />
                  </span>
                )}
                {message.own && message.status && !message.pending && (
                  <span
                    className={`message-status status-${message.status}`}
                    title={
                      message.status === "read"
                        ? "Прочитано"
                        : message.status === "delivered"
                          ? "Доставлено"
                          : "Отправлено"
                    }
                  >
                    {message.status === "sent" ? (
                      <Check size={13} />
                    ) : (
                      <CheckCheck size={13} />
                    )}
                  </span>
                )}
                {message.author === "ChatWave Bot" && <b>BOT</b>}
              </div>

              {message.replyToId && (
                <button
                  className="reply-quote"
                  onClick={() => replySource && onOpenMessage(replySource)}
                >
                  <MessageCircleMore size={13} />
                  <span>
                    <strong>{replySource?.author ?? "Сообщение"}</strong>
                    {replySource?.text ?? "Исходное сообщение"}
                  </span>
                </button>
              )}

              <p>{message.text}</p>
              {message.attachment && (
                <MessageMedia
                  message={message}
                  connected={connected && Boolean(chat.conversationId)}
                  onDownload={() => onDownload(message)}
                />
              )}
              {message.reaction && (
                <button className="reaction">{message.reaction}</button>
              )}
              {message.reactions && message.reactions.length > 0 && (
                <div className="reaction-list">
                  {message.reactions.map((reaction) => (
                    <button
                      key={reaction.emoji}
                      className={reaction.reacted ? "active" : ""}
                      onClick={() => onReact(message, reaction.emoji)}
                    >
                      {reaction.emoji} {reaction.count}
                    </button>
                  ))}
                </div>
              )}
              {reactionPickerFor === message.id && (
                <div className="reaction-picker">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button key={emoji} onClick={() => onReact(message, emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              {message.failed && message.retry && (
                <button
                  className="retry-message"
                  onClick={() => onRetry(message)}
                >
                  <RotateCcw size={13} />
                  Повторить отправку
                </button>
              )}
            </div>

            {!selectionMode && <div className="message-actions">
              <button
                aria-label="Реакция"
                onClick={() => onToggleReactionPicker(message.id)}
                disabled={!connected || !chat.conversationId}
              >
                <Smile size={15} />
              </button>
              <button aria-label="Ответить" onClick={() => onReply(message)}>
                <MessageCircleMore size={15} />
              </button>
              {connected && chat.conversationId && message.id > 0 && (
                <button
                  aria-label="Закрепить сообщение"
                  title="Закрепить"
                  onClick={() => onPin(message)}
                >
                  <Pin size={15} />
                </button>
              )}
              {connected &&
              chat.conversationId &&
              !message.pending &&
              !message.failed ? (
                <>
                  {message.own && !message.encrypted && (
                  <button
                    aria-label="Изменить сообщение"
                    onClick={() => onEdit(message)}
                  >
                    <Pencil size={15} />
                  </button>
                  )}
                  <button
                    aria-label="Удалить сообщение"
                    className="danger"
                    onClick={() => onDelete(message)}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              ) : (
                <button aria-label="Ещё">
                  <MoreHorizontal size={15} />
                </button>
              )}
            </div>}
          </article>
        );
      })}

      {(typingUsers.length > 0 || (!connected && chat.id === "team")) && (
        <div className="typing">
          <span className="avatar avatar-violet">МЧ</span>
          <span className="typing-bubble">
            <i />
            <i />
            <i />
          </span>
          <small>
            {typingUsers.length
              ? `${typingUsers.join(", ")} печатает…`
              : "Мила печатает…"}
          </small>
        </div>
      )}
    </div>
  );
}
