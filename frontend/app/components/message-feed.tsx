"use client";

import {
  CSSProperties,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
const LINK_PATTERN = /((?:https?:\/\/|www\.)[^\s<]+)/gi;

function messageTextWithLinks(text: string) {
  return text.split(LINK_PATTERN).map((part, index) => {
    if (!/^(?:https?:\/\/|www\.)/i.test(part)) return part;
    const trailing = part.match(/[),.!?:;]+$/)?.[0] ?? "";
    const address = trailing ? part.slice(0, -trailing.length) : part;
    const href = address.startsWith("www.") ? `https://${address}` : address;
    return (
      <span key={`${address}-${index}`}>
        <a
          className="message-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {address}
        </a>
        {trailing}
      </span>
    );
  });
}

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
  onOpenProfile: (userId: number) => void;
};

type MessageFeedItemProps = {
  message: Message;
  replySource?: Message;
  index: number;
  groupStart: boolean;
  groupEnd: boolean;
  conversationId: Chat["conversationId"];
  connected: boolean;
  selectionMode: boolean;
  selected: boolean;
  reactionPickerOpen: boolean;
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
  onOpenProfile: (userId: number) => void;
};

const MessageFeedItem = memo(function MessageFeedItem({
  message,
  replySource,
  index,
  groupStart,
  groupEnd,
  conversationId,
  connected,
  selectionMode,
  selected,
  reactionPickerOpen,
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
  onOpenProfile,
}: MessageFeedItemProps) {
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const renderKey = message.clientMessageId
    ? `client-${message.clientMessageId}`
    : `message-${message.id}`;

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
        data-render-key={renderKey}
        className={`call-history-event ${
          message.callEvent.outcome !== "completed" ? "missed" : ""
        }`}
        style={{ "--message-index": index } as CSSProperties}
      >
        <span className={`avatar avatar-${message.accent}`}>
          {message.avatarUrl ? (
            <img src={message.avatarUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            message.initials
          )}
        </span>
        <div>
          <strong>{message.author}</strong>
          <span>
            <PhoneCall size={15} />
            {message.text}
          </span>
          <small>
            {message.time}
            {duration ? ` · ${duration}` : ""}
          </small>
        </div>
      </article>
    );
  }

  return (
    <article
      id={`message-${message.id}`}
      data-render-key={renderKey}
      className={`message ${message.own ? "own" : ""} ${
        message.pending ? "pending" : ""
      } ${message.failed ? "failed" : ""} ${selected ? "selected" : ""} ${
        selectionMode && !message.pending && !message.failed ? "selectable" : ""
      } ${groupStart ? "group-start" : "group-continuation"} ${
        groupEnd ? "group-end" : ""
      } ${message.id < 0 ? "optimistic" : ""}`}
      style={{ "--message-index": index } as CSSProperties}
      onClick={
        selectionMode && !message.pending && !message.failed
          ? () => onToggleSelection(message.id)
          : undefined
      }
    >
      {selectionMode && !message.pending && !message.failed && (
        <button
          className="message-select"
          aria-label={selected ? "Снять выделение" : "Выбрать сообщение"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelection(message.id);
          }}
        >
          {selected && <Check size={14} />}
        </button>
      )}
      {groupStart && (
        <span className={`avatar avatar-${message.accent}`}>
          {message.avatarUrl ? (
            <img
              src={message.avatarUrl}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            message.initials
          )}
        </span>
      )}
      <div className="message-body">
        <div className="message-meta">
          {groupStart &&
            (message.senderId ? (
              <button
                className="message-author"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenProfile(message.senderId!);
                }}
                aria-label={`Открыть профиль ${message.author}`}
              >
                {message.author}
              </button>
            ) : (
              <strong>{message.author}</strong>
            ))}
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

        <p>{messageTextWithLinks(message.text)}</p>
        {message.attachment && (
          <MessageMedia
            message={message}
            connected={connected && Boolean(conversationId)}
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
        {reactionPickerOpen && (
          <div className="reaction-picker">
            {REACTION_EMOJIS.map((emoji) => (
              <button key={emoji} onClick={() => onReact(message, emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        )}
        {message.failed && message.retry && (
          <button className="retry-message" onClick={() => onRetry(message)}>
            <RotateCcw size={13} />
            Повторить отправку
          </button>
        )}
      </div>

      {!selectionMode && (
        <>
        <button
          className="mobile-message-more"
          aria-label="Действия с сообщением"
          aria-expanded={mobileActionsOpen}
          onClick={(event) => {
            event.stopPropagation();
            setMobileActionsOpen((current) => !current);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
        <div
          className={`message-actions ${
            mobileActionsOpen ? "mobile-open" : ""
          }`}
          onClick={() => setMobileActionsOpen(false)}
        >
          <button
            aria-label="Реакция"
            onClick={() => onToggleReactionPicker(message.id)}
            disabled={!connected || !conversationId}
          >
            <Smile size={15} />
          </button>
          <button aria-label="Ответить" onClick={() => onReply(message)}>
            <MessageCircleMore size={15} />
          </button>
          {connected && conversationId && message.id > 0 && (
            <button
              aria-label="Закрепить сообщение"
              title="Закрепить"
              onClick={() => onPin(message)}
            >
              <Pin size={15} />
            </button>
          )}
          {connected &&
          conversationId &&
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
        </div>
        </>
      )}
    </article>
  );
});

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
  onOpenProfile,
}: MessageFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollMetricsRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null>(null);
  const previousChatIdRef = useRef(chat.id);
  const previousLastMessageKeyRef = useRef<string | null>(null);
  const selectedMessages = useMemo(
    () => new Set(selectedMessageIds),
    [selectedMessageIds],
  );
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const sameMessageGroup = (left?: Message, right?: Message) => {
    if (!left || !right || left.callEvent || right.callEvent) return false;
    if (
      left.author !== right.author ||
      Boolean(left.own) !== Boolean(right.own) ||
      left.avatarUrl !== right.avatarUrl
    ) {
      return false;
    }
    const toMinutes = (value: string) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(value);
      return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const leftMinutes = toMinutes(left.time);
    const rightMinutes = toMinutes(right.time);
    return (
      leftMinutes === null ||
      rightMinutes === null ||
      Math.abs(rightMinutes - leftMinutes) <= 5
    );
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const chatChanged = previousChatIdRef.current !== chat.id;
    const lastMessage = messages.at(-1);
    const lastMessageKey = lastMessage
      ? lastMessage.clientMessageId ?? String(lastMessage.id)
      : null;
    const ownMessageAdded =
      Boolean(lastMessage?.own) &&
      previousLastMessageKeyRef.current !== lastMessageKey;
    const previous = scrollMetricsRef.current;
    const wasNearBottom =
      !previous ||
      previous.scrollHeight - previous.scrollTop - previous.clientHeight < 96;
    if (chatChanged || ownMessageAdded || wasNearBottom) {
      element.scrollTop = element.scrollHeight;
    }
    previousChatIdRef.current = chat.id;
    previousLastMessageKeyRef.current = lastMessageKey;
    scrollMetricsRef.current = {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  }, [chat.id, messages]);

  return (
    <div
      ref={scrollRef}
      className="messages-scroll"
      onScroll={(event) => {
        const element = event.currentTarget;
        scrollMetricsRef.current = {
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      }}
    >
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
        const groupStart = !sameMessageGroup(messages[index - 1], message);
        const groupEnd = !sameMessageGroup(message, messages[index + 1]);
        return (
          <MessageFeedItem
          key={
            message.clientMessageId
              ? `client-${message.clientMessageId}`
              : `message-${message.id}`
          }
          message={message}
          groupStart={groupStart}
          groupEnd={groupEnd}
          replySource={
            message.replyToId ? messagesById.get(message.replyToId) : undefined
          }
          index={index}
          conversationId={chat.conversationId}
          connected={connected}
          selectionMode={selectionMode}
          selected={selectedMessages.has(message.id)}
          reactionPickerOpen={reactionPickerFor === message.id}
          onOpenMessage={onOpenMessage}
          onDownload={onDownload}
          onReact={onReact}
          onToggleReactionPicker={onToggleReactionPicker}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onRetry={onRetry}
          onPin={onPin}
          onToggleSelection={onToggleSelection}
          onOpenProfile={onOpenProfile}
          />
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
