"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Images,
  MoreHorizontal,
  Pencil,
  Pin,
  Save,
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
  onGroupUpdated?: () => void;
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
  onGroupUpdated,
  onOpenMessage,
  onDownload,
}: ChatDetailsProps) {
  const [tab, setTab] = useState<DetailsTab>("overview");
  const [items, setItems] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [avatarHistoryOpen, setAvatarHistoryOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupName, setGroupName] = useState(chat.title);
  const [groupDescription, setGroupDescription] = useState(chat.description);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState("");
  const groupAvatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const resetTimer = window.setTimeout(() => {
      setTab("overview");
      setItems([]);
      setEditingGroup(false);
      setGroupError("");
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [chat.conversationId]);

  useEffect(() => {
    if (editingGroup) return;
    const syncTimer = window.setTimeout(() => {
      setGroupName(chat.title);
      setGroupDescription(chat.description);
    }, 0);
    return () => window.clearTimeout(syncTimer);
  }, [chat.description, chat.title, editingGroup]);

  useEffect(() => {
    if (
      !open ||
      !chat.conversationId ||
      tab === "overview"
    ) {
      return;
    }
    let active = true;
    const loadingTimer = window.setTimeout(
      () => active && setLoading(true),
      0,
    );
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
      window.clearTimeout(loadingTimer);
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

  const saveGroup = async () => {
    if (!chat.conversationId || !groupName.trim()) return;
    setGroupSaving(true);
    setGroupError("");
    try {
      await chatWaveApi.updateGroup(chat.conversationId, {
        name: groupName.trim(),
        description: groupDescription.trim() || null,
      });
      setEditingGroup(false);
      onGroupUpdated?.();
    } catch (reason) {
      setGroupError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить группу",
      );
    } finally {
      setGroupSaving(false);
    }
  };

  const uploadGroupAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !chat.conversationId) return;
    setGroupSaving(true);
    setGroupError("");
    try {
      await chatWaveApi.uploadGroupAvatar(chat.conversationId, file);
      onGroupUpdated?.();
    } catch (reason) {
      setGroupError(
        reason instanceof Error
          ? reason.message
          : "Не удалось обновить аватар группы",
      );
    } finally {
      setGroupSaving(false);
    }
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
            {chat.type === "group" &&
              ["creator", "admin"].includes(chat.currentUserRole ?? "") && (
                <button
                  className="group-edit-button"
                  onClick={() => setEditingGroup((current) => !current)}
                  aria-label="Редактировать группу"
                  title="Редактировать группу"
                >
                  <Pencil size={15} />
                </button>
              )}
            <button
              className={`avatar avatar-${chat.accent}`}
              onClick={() => {
                if (chat.type === "direct" && chat.recipientId) {
                  setAvatarHistoryOpen(true);
                } else if (
                  chat.type === "group" &&
                  ["creator", "admin"].includes(chat.currentUserRole ?? "")
                ) {
                  groupAvatarInput.current?.click();
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
            {editingGroup ? (
              <div className="group-profile-editor">
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  maxLength={64}
                  aria-label="Название группы"
                />
                <textarea
                  value={groupDescription}
                  onChange={(event) =>
                    setGroupDescription(event.target.value)
                  }
                  maxLength={256}
                  rows={3}
                  placeholder="Описание группы"
                  aria-label="Описание группы"
                />
                <button
                  className="primary-button"
                  onClick={() => void saveGroup()}
                  disabled={groupSaving || !groupName.trim()}
                >
                  <Save size={15} />
                  {groupSaving ? "Сохраняем…" : "Сохранить"}
                </button>
              </div>
            ) : (
              <strong>{chat.title}</strong>
            )}
            {chat.type === "direct" && chat.recipientUsername && (
              <span className="details-username">
                @{chat.recipientUsername}
              </span>
            )}
            {chat.description &&
              !editingGroup &&
              !["Личный диалог", "Групповое пространство"].includes(
                chat.description,
              ) && <p>{chat.description}</p>}
            <input
              ref={groupAvatarInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => void uploadGroupAvatar(event)}
            />
            {groupError && (
              <small className="group-profile-error" role="alert">
                {groupError}
              </small>
            )}
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

          {chat.type === "group" && (
            <>
              <div className="members-title">
                <span>
                  <Users size={14} />
                  Участники · {chat.memberCount}
                </span>
                {onAddMember && (
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
                        {[
                          member.username ? `@${member.username}` : "",
                          member.role,
                          member.presenceText,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    <MoreHorizontal size={16} />
                  </button>
                ))}
              </div>
            </>
          )}
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
