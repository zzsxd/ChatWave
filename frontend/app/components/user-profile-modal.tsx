"use client";

import { AtSign, MessageCircleMore, UserRound, X } from "lucide-react";
import { ApiUser, chatWaveApi } from "../api";
import { AvatarHistoryModal } from "./avatar-history-modal";
import { useState } from "react";

export function UserProfileModal({
  user,
  own,
  onClose,
  onMessage,
  onEditOwnProfile,
}: {
  user: ApiUser;
  own: boolean;
  onClose: () => void;
  onMessage: () => void;
  onEditOwnProfile: () => void;
}) {
  const [avatarHistoryOpen, setAvatarHistoryOpen] = useState(false);
  const avatarUrl = chatWaveApi.avatarUrl(user.avatar_name);

  return (
    <>
      <div className="modal-backdrop user-profile-backdrop" onMouseDown={onClose}>
        <section
          className="user-profile-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-profile-name"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Закрыть профиль"
          >
            <X size={18} />
          </button>
          <button
            className="user-profile-avatar"
            onClick={() => setAvatarHistoryOpen(true)}
            aria-label="Открыть фотографии профиля"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" />
            ) : (
              user.nickname.slice(0, 2).toUpperCase()
            )}
          </button>
          <h2 id="user-profile-name">{user.nickname}</h2>
          {user.username && (
            <span className="user-profile-username">
              <AtSign size={14} />
              {user.username}
            </span>
          )}
          {user.bio && <p>{user.bio}</p>}
          <button
            className="primary-button user-profile-action"
            onClick={own ? onEditOwnProfile : onMessage}
          >
            {own ? <UserRound size={17} /> : <MessageCircleMore size={17} />}
            {own ? "Редактировать профиль" : "Написать сообщение"}
          </button>
        </section>
      </div>
      {avatarHistoryOpen && (
        <AvatarHistoryModal
          userId={user.id}
          onClose={() => setAvatarHistoryOpen(false)}
        />
      )}
    </>
  );
}
