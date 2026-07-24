"use client";

import { FormEvent, useState } from "react";
import { Check, Search, UserPlus, X } from "lucide-react";
import { ApiPublicUser, chatWaveApi } from "../api";

export function AddGroupMembersModal({
  groupId,
  currentUserId,
  existingMemberIds,
  onClose,
  onAdded,
}: {
  groupId: number;
  currentUserId: number;
  existingMemberIds: number[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiPublicUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const existing = new Set([...existingMemberIds, currentUserId]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 3) return;
    setLoading(true);
    setError("");
    try {
      const users = await chatWaveApi.searchUsers(value);
      setResults(users.filter((user) => !existing.has(user.id)));
      setSearched(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось найти пользователей",
      );
    } finally {
      setLoading(false);
    }
  };

  const addMembers = async () => {
    if (!selectedIds.length) return;
    setAdding(true);
    setError("");
    try {
      await chatWaveApi.addGroupMembers(groupId, selectedIds);
      onAdded();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось добавить участников",
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="new-conversation-modal add-members-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-members-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Закрыть">
          <X size={18} />
        </button>
        <span className="eyebrow">Участники группы</span>
        <h2 id="add-members-title">Добавить участников</h2>
        <p>Найдите пользователей и выберите одного или нескольких.</p>

        <form className="people-search-form" onSubmit={search}>
          <Search size={17} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Введите минимум 3 символа"
            minLength={3}
            maxLength={128}
            required
          />
          <button disabled={loading || query.trim().length < 3}>
            {loading ? "Ищем…" : "Найти"}
          </button>
        </form>

        <div className="people-results" aria-live="polite">
          {results.map((user) => {
            const selected = selectedIds.includes(user.id);
            return (
              <button
                key={user.id}
                type="button"
                className={`people-result selectable-person ${
                  selected ? "selected" : ""
                }`}
                onClick={() =>
                  setSelectedIds((current) =>
                    selected
                      ? current.filter((id) => id !== user.id)
                      : [...current, user.id],
                  )
                }
              >
                <span className="avatar avatar-blue">
                  {user.nickname.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{user.nickname}</strong>
                  <small>{user.bio || "Пользователь ChatWave"}</small>
                </span>
                <b className="person-check">{selected && <Check size={15} />}</b>
              </button>
            );
          })}
          {searched && !results.length && !loading && (
            <div className="people-empty">
              <Search size={23} />
              <strong>Подходящих пользователей нет</strong>
              <span>Они уже в группе или не найдены.</span>
            </div>
          )}
        </div>

        <button
          className="primary-button add-selected-members"
          onClick={() => void addMembers()}
          disabled={adding || selectedIds.length === 0}
        >
          <UserPlus size={18} />
          {adding
            ? "Добавляем…"
            : `Добавить${selectedIds.length ? ` · ${selectedIds.length}` : ""}`}
        </button>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}
