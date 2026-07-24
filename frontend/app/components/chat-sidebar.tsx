"use client";

import {
  BellOff,
  ChevronDown,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { Chat } from "../models";
import {
  ChatFilter,
  NavigationMode,
} from "../hooks/use-ui-state";

type ChatSidebarProps = {
  chats: Chat[];
  selectedChatId: string;
  mobileOpen: boolean;
  navMode: NavigationMode;
  filter: ChatFilter;
  query: string;
  unreadCount: number;
  onSelectChat: (chat: Chat) => void;
  onNavigationChange: (mode: NavigationMode) => void;
  onFilterChange: (filter: ChatFilter) => void;
  onQueryChange: (query: string) => void;
  onNewConversation: () => void;
  onOpenProfile: () => void;
};

export function ChatSidebar({
  chats,
  selectedChatId,
  mobileOpen,
  navMode,
  filter,
  query,
  unreadCount,
  onSelectChat,
  onNavigationChange,
  onFilterChange,
  onQueryChange,
  onNewConversation,
  onOpenProfile,
}: ChatSidebarProps) {
  return (
    <aside className={`chat-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <header className="sidebar-header">
        <div>
          <button
            className="workspace-title"
            onClick={() =>
              onNavigationChange(navMode === "groups" ? "messages" : "groups")
            }
          >
            ChatWave <ChevronDown size={16} />
          </button>
        </div>
        <div className="sidebar-header-actions">
          <button
            className="icon-button mobile-profile-button"
            aria-label="Настройки профиля"
            title="Настройки профиля"
            onClick={onOpenProfile}
          >
            <UserRound size={18} />
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
        <kbd>⌘ K</kbd>
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
        {chats.map((chat) => (
          <button
            key={chat.id}
            className={`chat-row ${selectedChatId === chat.id ? "active" : ""}`}
            onClick={() => onSelectChat(chat)}
          >
            <span className={`avatar avatar-${chat.accent}`}>
              {chat.avatarUrl ? <img src={chat.avatarUrl} alt="" /> : chat.initials}
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
        ))}
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

    </aside>
  );
}
