"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Images,
  MoreHorizontal,
  Pin,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { ApiUser, chatWaveApi } from "../api";
import { Chat, Member, Message, mapApiMessage } from "../models";
import { MessageMedia } from "./message-media";
import { AvatarHistoryModal } from "./avatar-history-modal";

type DetailsTab = "overview" | "media" | "files" | "pinned";

type ChatDetailsProps = {
  chat: Chat;
  members: Member[];
  currentUser: ApiUser;
  users: Record<number, ApiUser>;
  open: boolean;
  revision: number;
  onClose: () => void;
  onAddMember?: () => void;
  onOpenMessage: (message: Message) => void;
  onDownload: (message: Message) => void;
};

export function ChatDetails({
  chat,
  members,
  currentUser,
  users,
  open,
  revision,
  onClose,
  onAddMember,
  onOpenMessage,
  onDownload,
}: ChatDetailsProps) {
  const [tab, setTab] = useState<DetailsTab>("overview");
  const [items, setItems] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [avatarHistoryOpen, setAvatarHistoryOpen] = useState(false);

  useEffect(() => {
    setTab("overview");
    setItems([]);
  }, [chat.conversationId]);

  useEffect(() => {
    if (
      !open ||
      !chat.conversationId ||
      tab === "overview"
    ) {
      return;
    }
    let active = true;
    setLoading(true);
    const request =
      tab === "pinned"
        ? chatWaveApi.pinnedMessages(chat.conversationId)
        : chatWaveApi.conversationMedia(
            chat.conversationId,
            tab === "media" ? "media" : "files",
          );
    void request
      .then((messages) => {
        if (!active) return;
        setItems(
          messages.map((message) =>
            mapApiMessage(message, chat, currentUser, users),
          ),
        );
      })
      .catch(() => active && setItems([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [chat, currentUser, open, revision, tab, users]);

  const openTab = (next: DetailsTab) => {
    setItems([]);
    setTab(next);
  };

  const unpin = async (messageId: number) => {
    await chatWaveApi.unpinMessage(messageId);
    setItems((current) => current.filter((message) => message.id !== messageId));
  };

  const title = {
    overview: chat.type === "group" ? "Информация" : "Профиль",
    media: "Медиа",
    files: "Файлы и аудио",
    pinned: "Закреплённые",
  }[tab];

  return (
    <aside className={`details-panel ${open ? "open" : ""}`}>
      <div className="details-head">
        {tab !== "overview" && (
          <button onClick={() => setTab("overview")} aria-label="Назад">
            <ArrowLeft size={18} />
          </button>
        )}
        <strong>{title}</strong>
        <button onClick={onClose} aria-label="Закрыть">
          <X size={18} />
        </button>
      </div>

      {tab === "overview" ? (
        <>
          <div className="details-hero compact">
            <button
              className={`avatar avatar-${chat.accent}`}
              onClick={() => {
                if (chat.type === "direct" && chat.recipientId) {
                  setAvatarHistoryOpen(true);
                }
              }}
              aria-label={
                chat.type === "direct"
                  ? "Открыть фотографии профиля"
                  : undefined
              }
            >
              {chat.avatarUrl ? (
                <img src={chat.avatarUrl} alt="" />
              ) : (
                chat.initials
              )}
              {chat.online && <i />}
            </button>
            <strong>{chat.title}</strong>
            {chat.description &&
              !["Личный диалог", "Групповое пространство"].includes(
                chat.description,
              ) && <p>{chat.description}</p>}
          </div>

          <div className="details-section details-navigation">
            <button onClick={() => openTab("media")}>
              <span>
                <Images size={16} /> Медиа
              </span>
            </button>
            <button onClick={() => openTab("files")}>
              <span>
                <FileText size={16} /> Файлы и аудио
              </span>
            </button>
            <button onClick={() => openTab("pinned")}>
              <span>
                <Pin size={16} /> Закреплённые
              </span>
            </button>
          </div>

          <div className="members-title">
            <span>
              <Users size={14} />
              {chat.type === "group"
                ? `Участники · ${chat.memberCount}`
                : "Участники"}
            </span>
            {chat.type === "group" && onAddMember && (
              <button aria-label="Добавить участника" onClick={onAddMember}>
                <UserPlus size={16} />
              </button>
            )}
          </div>
          <div className="member-list">
            {members.map((member) => (
              <button key={member.name}>
                <span className={`avatar avatar-${member.accent}`}>
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" />
                  ) : (
                    member.initials
                  )}
                  {member.online && <i />}
                </span>
                <span>
                  <strong>{member.name}</strong>
                  <small>
                    {[member.role, member.presenceText]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <MoreHorizontal size={16} />
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className={`details-collection details-${tab}`}>
          {loading && (
            <div className="details-loading">
              <span className="media-loader" />
              Загружаем…
            </div>
          )}
          {!loading &&
            items.map((message) => (
              <article key={message.id} className="details-collection-item">
                {tab === "pinned" && (
                  <button
                    className="pinned-message-copy"
                    onClick={() => onOpenMessage(message)}
                  >
                    <strong>{message.author}</strong>
                    <span>
                      {message.text ||
                        message.attachment?.name ||
                        "Сообщение"}
                    </span>
                    <small>{message.time}</small>
                  </button>
                )}
                {message.attachment && (
                  <MessageMedia
                    message={message}
                    connected
                    onDownload={() => onDownload(message)}
                  />
                )}
                {tab === "pinned" && (
                  <button
                    className="unpin-message"
                    onClick={() => void unpin(message.id)}
                    aria-label="Открепить сообщение"
                    title="Открепить"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </article>
            ))}
          {!loading && !items.length && (
            <div className="details-empty">
              {tab === "media" ? (
                <Images size={26} />
              ) : tab === "pinned" ? (
                <Pin size={26} />
              ) : (
                <FileText size={26} />
              )}
              <strong>Здесь пока пусто</strong>
            </div>
          )}
        </div>
      )}

      {avatarHistoryOpen && chat.recipientId && (
        <AvatarHistoryModal
          userId={chat.recipientId}
          onClose={() => setAvatarHistoryOpen(false)}
        />
      )}
    </aside>
  );
}
