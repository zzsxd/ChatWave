"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const searchSequenceRef = useRef(0);
  const activeSearchRef = useRef<AbortController | null>(null);
  const existing = useMemo(
    () => new Set([...existingMemberIds, currentUserId]),
    [currentUserId, existingMemberIds],
  );

  const performSearch = useCallback(async (rawValue: string) => {
    const value = rawValue.trim().replace(/^@/, "");
    const sequence = ++searchSequenceRef.current;
    activeSearchRef.current?.abort();
    if (!value) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const controller = new AbortController();
    activeSearchRef.current = controller;
    try {
      const users = await chatWaveApi.searchUsers(value, 30, controller.signal);
      if (sequence !== searchSequenceRef.current) return;
      setResults(users.filter((user) => !existing.has(user.id)));
      setSearched(true);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (sequence !== searchSequenceRef.current) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось найти пользователей",
      );
    } finally {
      if (activeSearchRef.current === controller) {
        activeSearchRef.current = null;
      }
      if (sequence === searchSequenceRef.current) setLoading(false);
    }
  }, [existing]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void performSearch(query);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [performSearch, query]);

  useEffect(
    () => () => {
      activeSearchRef.current?.abort();
    },
    [],
  );

  const search = (event: FormEvent) => {
    event.preventDefault();
    void performSearch(query);
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
        <p>Найдите пользователей по username и выберите участников.</p>

        <form className="people-search-form" onSubmit={search}>
          <Search size={17} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="@username"
            maxLength={64}
            required
          />
          <button disabled={loading || !query.trim().replace(/^@/, "")}>
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
                  <small>
                    @{user.username}
                    {user.bio ? ` · ${user.bio}` : ""}
                  </small>
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
