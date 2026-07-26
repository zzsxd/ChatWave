"use client";

import {
  BellOff,
  Bookmark,
  PhoneCall,
  Pin,
  Plus,
  Search,
} from "lucide-react";
import { type PointerEvent as ReactPointerEvent } from "react";
import { ApiActiveGroupCall, ApiUser, chatWaveApi } from "../api";
import { Chat } from "../models";
import {
  ChatFilter,
} from "../hooks/use-ui-state";

type ChatSidebarProps = {
  chats: Chat[];
  selectedChatId: string;
  mobileOpen: boolean;
  filter: ChatFilter;
  query: string;
  unreadCount: number;
  currentUser: ApiUser;
  compact: boolean;
  activeGroupCalls: ApiActiveGroupCall[];
  onSelectChat: (chat: Chat) => void;
  onFilterChange: (filter: ChatFilter) => void;
  onQueryChange: (query: string) => void;
  onNewConversation: () => void;
  onOpenProfile: () => void;
  onTogglePin: (chat: Chat) => void;
  onJoinGroupCall: (call: ApiActiveGroupCall) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function ChatSidebar({
  chats,
  selectedChatId,
  mobileOpen,
  filter,
  query,
  unreadCount,
  currentUser,
  compact,
  activeGroupCalls,
  onSelectChat,
  onFilterChange,
  onQueryChange,
  onNewConversation,
  onOpenProfile,
  onTogglePin,
  onJoinGroupCall,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: ChatSidebarProps) {
  return (
    <aside
      className={`chat-sidebar ${mobileOpen ? "mobile-open" : ""} ${
        compact ? "compact" : ""
      }`}
    >
      <header className="sidebar-header">
        <img className="sidebar-brand-logo" src="/chatwave-logo.svg" alt="ChatWave" />
        <div className="sidebar-header-actions">
          <button
            className="sidebar-profile-avatar"
            aria-label="Настройки профиля"
            title="Настройки профиля"
            onClick={onOpenProfile}
          >
            {currentUser.avatar_name ? (
              <img
                src={chatWaveApi.avatarUrl(currentUser.avatar_name) ?? ""}
                alt=""
              />
            ) : (
              currentUser.nickname.slice(0, 2).toUpperCase()
            )}
          </button>
          <button
            className="icon-button new-chat"
            aria-label="Новое сообщение"
            title="Новое сообщение"
            onClick={onNewConversation}
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      <div className="search-box">
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Поиск"
          aria-label="Поиск чатов"
        />
      </div>

      <div className="chat-filters">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => onFilterChange("all")}
        >
          Все
        </button>
        <button
          className={filter === "unread" ? "active" : ""}
          onClick={() => onFilterChange("unread")}
        >
          Непрочитанные <span>{unreadCount}</span>
        </button>
      </div>

      <div className="chat-list">
        {chats.map((chat) => {
          const activeCall = activeGroupCalls.find(
            (call) => call.conversation_id === chat.conversationId,
          );
          return (
          <div
            key={chat.id}
            className={`chat-row ${selectedChatId === chat.id ? "active" : ""} ${
              chat.pinned ? "pinned" : ""
            }`}
          >
            <button
              className="chat-row-main"
              onClick={() => onSelectChat(chat)}
              aria-label={`Открыть чат ${chat.title}`}
            >
              <span className={`avatar avatar-${chat.accent}`}>
                {chat.type === "saved" ? (
                  <Bookmark size={20} fill="currentColor" />
                ) : chat.avatarUrl ? (
                  <img src={chat.avatarUrl} alt="" />
                ) : (
                  chat.initials
                )}
                {chat.online && <i />}
              </span>
              <span className="chat-copy">
                <span className="chat-title-row">
                  <strong>{chat.title}</strong>
                  <time>{chat.time}</time>
                </span>
                <span className="chat-preview-row">
                  <span>{chat.preview}</span>
                  {chat.muted && <BellOff size={13} />}
                  {chat.unread && <b>{chat.unread}</b>}
                </span>
              </span>
            </button>
            {activeCall && (
              <button
                className="chat-call-live"
                onClick={() => {
                  onSelectChat(chat);
                  onJoinGroupCall(activeCall);
                }}
                aria-label={`Подключиться к звонку в ${chat.title}`}
                title="Идёт групповой звонок — подключиться"
              >
                <PhoneCall size={13} />
                <span>{activeCall.participant_count}</span>
              </button>
            )}
            <button
              className="chat-pin-button"
              onClick={() => onTogglePin(chat)}
              aria-label={chat.pinned ? "Открепить чат" : "Закрепить чат"}
              title={chat.pinned ? "Открепить" : "Закрепить"}
            >
              <Pin size={13} fill={chat.pinned ? "currentColor" : "none"} />
            </button>
          </div>
          );
        })}
        {!chats.length && (
          <div className="empty-search">
            <Search size={24} />
            <strong>{query ? "Ничего не найдено" : "Пока нет чатов"}</strong>
            <span>
              {query
                ? "Попробуйте другой запрос"
                : "Найдите человека или создайте группу"}
            </span>
            {!query && (
              <button onClick={onNewConversation}>
                <Plus size={15} /> Начать общение
              </button>
            )}
          </div>
        )}
      </div>

      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label="Изменить ширину списка чатов"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
    </aside>
  );
}
