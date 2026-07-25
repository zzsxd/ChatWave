"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  Download,
  KeyRound,
  History,
  Save,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { ApiUser, chatWaveApi } from "../api";
import { AvatarHistoryModal } from "./avatar-history-modal";
import {
  createRecoveryKey,
  localRecoveryKey,
  restoreRoomKeys,
} from "../e2ee/client";

type ProfileTab = "profile" | "security";

export function ProfileSettingsModal({
  user,
  onClose,
  onUpdated,
  onPasswordChanged,
}: {
  user: ApiUser;
  onClose: () => void;
  onUpdated: (user: ApiUser) => void;
  onPasswordChanged: () => void;
}) {
  const [tab, setTab] = useState<ProfileTab>("profile");
  const [nickname, setNickname] = useState(user.nickname);
  const [username, setUsername] = useState(user.username ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [birthday, setBirthday] = useState(user.birthday ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [avatarPreview, setAvatarPreview] = useState(
    chatWaveApi.avatarUrl(user.avatar_name),
  );
  const [loading, setLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [hasLocalRecovery, setHasLocalRecovery] = useState(
    () => Boolean(localRecoveryKey(user.id)),
  );
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    },
    [avatarPreview],
  );

  const refreshProfile = async () => {
    const updated = await chatWaveApi.me();
    onUpdated(updated);
    setAvatarPreview(chatWaveApi.avatarUrl(updated.avatar_name));
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    const changes: {
      nickname?: string;
      username?: string;
      bio?: string;
      birthday?: string;
    } = {};
    if (nickname.trim() !== user.nickname) changes.nickname = nickname.trim();
    if (username.trim().toLowerCase() !== user.username) {
      changes.username = username.trim().toLowerCase();
    }
    if (bio.trim() !== (user.bio ?? "")) changes.bio = bio.trim();
    if (birthday !== (user.birthday ?? "")) changes.birthday = birthday;
    if (!Object.keys(changes).length) {
      setSuccess("Профиль уже актуален");
      return;
    }
    setLoading(true);
    try {
      await chatWaveApi.updateProfile(changes);
      await refreshProfile();
      setSuccess("Изменения сохранены");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось обновить профиль",
      );
    } finally {
      setLoading(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setError("");
    setSuccess("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Выберите изображение JPG, PNG или WebP");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("Размер изображения не должен превышать 20 МБ");
      return;
    }
    const preview = URL.createObjectURL(file);
    setAvatarPreview((current) => {
      if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
      return preview;
    });
    setAvatarLoading(true);
    try {
      await chatWaveApi.uploadAvatar(file);
      await refreshProfile();
      setSuccess("Аватар обновлён");
    } catch (reason) {
      setAvatarPreview(chatWaveApi.avatarUrl(user.avatar_name));
      setError(
        reason instanceof Error ? reason.message : "Не удалось загрузить аватар",
      );
    } finally {
      setAvatarLoading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeAvatar = async () => {
    if (!user.avatar_name) return;
    setAvatarLoading(true);
    setError("");
    setSuccess("");
    try {
      await chatWaveApi.deleteAvatar();
      await refreshProfile();
      setAvatarPreview(null);
      setSuccess("Аватар удалён");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось удалить аватар",
      );
    } finally {
      setAvatarLoading(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (newPassword !== confirmPassword) {
      setError("Новые пароли не совпадают");
      return;
    }
    if (
      !/[a-z]/.test(newPassword) ||
      !/[A-Z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      setError("Новый пароль должен содержать строчную, заглавную буквы и цифру");
      return;
    }
    setLoading(true);
    try {
      await chatWaveApi.changePassword(currentPassword, newPassword);
      setSuccess("Пароль изменён. Войдите снова");
      window.setTimeout(onPasswordChanged, 900);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось изменить пароль",
      );
    } finally {
      setLoading(false);
    }
  };

  const createE2EERecovery = async () => {
    setRecoveryLoading(true);
    setError("");
    setSuccess("");
    try {
      const key = await createRecoveryKey(user.id);
      setGeneratedRecoveryKey(key);
      setHasLocalRecovery(true);
      setSuccess("Резервная копия ключей создана");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось создать резервную копию ключей",
      );
    } finally {
      setRecoveryLoading(false);
    }
  };

  const restoreE2EE = async () => {
    if (!recoveryInput.trim()) return;
    setRecoveryLoading(true);
    setError("");
    setSuccess("");
    try {
      await restoreRoomKeys(user.id, recoveryInput);
      setRecoveryInput("");
      setHasLocalRecovery(true);
      setSuccess("Ключи сообщений восстановлены на этом устройстве");
      window.setTimeout(() => window.location.reload(), 900);
    } catch {
      setError("Неверный ключ восстановления или повреждённая копия");
    } finally {
      setRecoveryLoading(false);
    }
  };

  return (
    <div className="modal-backdrop profile-settings-backdrop" onMouseDown={onClose}>
      <section
        className="profile-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Закрыть">
          <X size={18} />
        </button>

        <header className="profile-settings-header">
          <span className="eyebrow">Ваше пространство</span>
          <h2 id="profile-settings-title">Настройки профиля</h2>
          <p>Управляйте тем, как вас видят другие участники ChatWave.</p>
        </header>

        <div className="profile-settings-layout">
          <nav className="profile-settings-nav" aria-label="Разделы профиля">
            <button
              className={tab === "profile" ? "active" : ""}
              onClick={() => {
                setTab("profile");
                setError("");
                setSuccess("");
              }}
            >
              <UserRound size={17} />
              Профиль
            </button>
            <button
              className={tab === "security" ? "active" : ""}
              onClick={() => {
                setTab("security");
                setError("");
                setSuccess("");
              }}
            >
              <KeyRound size={17} />
              Безопасность
            </button>
          </nav>

          <div className="profile-settings-content">
            {tab === "profile" ? (
              <>
                <div className="profile-avatar-editor">
                  <button
                    className="profile-avatar-preview"
                    onClick={() => fileInput.current?.click()}
                    disabled={avatarLoading}
                    aria-label="Изменить аватар"
                  >
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="" />
                    ) : (
                      <span>{nickname.slice(0, 2).toUpperCase()}</span>
                    )}
                    <i>
                      {avatarLoading ? (
                        <span className="button-spinner" />
                      ) : (
                        <Camera size={18} />
                      )}
                    </i>
                  </button>
                  <div>
                    <strong>Фотография профиля</strong>
                    <span>JPG, PNG или WebP · до 20 МБ</span>
                    <div className="profile-avatar-actions">
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        disabled={avatarLoading}
                      >
                        Загрузить
                      </button>
                      {user.avatar_name && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void removeAvatar()}
                          disabled={avatarLoading}
                        >
                          <Trash2 size={14} /> Удалить
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setHistoryOpen(true)}
                      >
                        <History size={14} /> История
                      </button>
                    </div>
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void uploadAvatar(file);
                    }}
                  />
                </div>

                <form className="profile-settings-form" onSubmit={saveProfile}>
                  <div className="profile-field-row">
                    <label>
                      Отображаемое имя
                      <input
                        value={nickname}
                        onChange={(event) => setNickname(event.target.value)}
                        minLength={3}
                        maxLength={128}
                        required
                      />
                    </label>
                    <label>
                      Имя пользователя
                      <div className="username-input">
                        <span>@</span>
                        <input
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                          minLength={3}
                          maxLength={64}
                          pattern="[a-zA-Z0-9_.-]+"
                          required
                        />
                      </div>
                    </label>
                  </div>
                  <label>
                    О себе
                    <textarea
                      value={bio}
                      onChange={(event) => setBio(event.target.value)}
                      maxLength={8192}
                      rows={4}
                      placeholder="Расскажите немного о себе"
                    />
                    <small>{bio.length} / 8192</small>
                  </label>
                  <label>
                    Дата рождения
                    <input
                      type="date"
                      value={birthday}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(event) => setBirthday(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={loading}>
                    <Save size={17} />
                    {loading ? "Сохраняем…" : "Сохранить профиль"}
                  </button>
                </form>
              </>
            ) : (
              <div className="security-settings-stack">
              <section className="e2ee-recovery-card">
                <div className="security-note">
                  <KeyRound size={20} />
                  <div>
                    <strong>Восстановление E2EE</strong>
                    <span>
                      Сервер хранит только зашифрованную копию ключей. Без
                      recovery key прочитать старые сообщения на новом
                      устройстве невозможно.
                    </span>
                  </div>
                </div>
                <div className="recovery-status">
                  {hasLocalRecovery
                    ? "Резервное копирование включено"
                    : "Recovery key ещё не создан"}
                </div>
                <button
                  type="button"
                  className="primary-button"
                  disabled={recoveryLoading}
                  onClick={() => void createE2EERecovery()}
                >
                  <KeyRound size={17} />
                  {hasLocalRecovery
                    ? "Создать новый recovery key"
                    : "Создать recovery key"}
                </button>
                {generatedRecoveryKey && (
                  <div className="generated-recovery-key">
                    <strong>Сохраните ключ сейчас</strong>
                    <code>{generatedRecoveryKey}</code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          generatedRecoveryKey,
                        );
                        setSuccess("Recovery key скопирован");
                      }}
                    >
                      <Copy size={15} /> Копировать
                    </button>
                    <small>
                      ChatWave не сможет показать этот ключ после закрытия
                      окна.
                    </small>
                  </div>
                )}
                <label>
                  Восстановить на новом устройстве
                  <input
                    type="password"
                    value={recoveryInput}
                    onChange={(event) => setRecoveryInput(event.target.value)}
                    placeholder="Вставьте recovery key"
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  disabled={!recoveryInput.trim() || recoveryLoading}
                  onClick={() => void restoreE2EE()}
                >
                  <Download size={16} /> Восстановить ключи сообщений
                </button>
              </section>
              <form className="profile-settings-form" onSubmit={savePassword}>
                <div className="security-note">
                  <KeyRound size={20} />
                  <div>
                    <strong>Смена пароля</strong>
                    <span>
                      После изменения все активные сессии будут завершены.
                    </span>
                  </div>
                </div>
                <label>
                  Текущий пароль
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Новый пароль
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </label>
                <label>
                  Повторите новый пароль
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </label>
                <small className="profile-password-hint">
                  Минимум 8 символов, заглавная и строчная буквы, цифра.
                </small>
                <button className="primary-button" disabled={loading}>
                  <KeyRound size={17} />
                  {loading ? "Обновляем…" : "Изменить пароль"}
                </button>
              </form>
              </div>
            )}

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            {success && (
              <div className="profile-success" role="status">
                <Check size={16} />
                {success}
              </div>
            )}
          </div>
        </div>
      </section>
      {historyOpen && (
        <AvatarHistoryModal
          userId={user.id}
          canRestore
          onClose={() => setHistoryOpen(false)}
          onRestored={() => {
            void refreshProfile();
            setSuccess("Фотография профиля восстановлена");
          }}
        />
      )}
    </div>
  );
}
