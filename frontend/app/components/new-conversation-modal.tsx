"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Search, UserRoundPlus, UsersRound, X } from "lucide-react";
import { ApiPublicUser, chatWaveApi } from "../api";

type CreationMode = "direct" | "group";

export function NewConversationModal({
  currentUserId,
  onClose,
  onCreated,
}: {
  currentUserId: number;
  onClose: () => void;
  onCreated: (conversationId: number) => void;
}) {
  const [mode, setMode] = useState<CreationMode>("direct");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiPublicUser[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [creatingId, setCreatingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const searchSequenceRef = useRef(0);
  const activeSearchRef = useRef<AbortController | null>(null);
  const creatingGroupRef = useRef(false);

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
      setResults(users.filter((user) => user.id !== currentUserId));
      setSearched(true);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (sequence !== searchSequenceRef.current) return;
      setError(
        reason instanceof Error ? reason.message : "Не удалось найти пользователей",
      );
    } finally {
      if (activeSearchRef.current === controller) {
        activeSearchRef.current = null;
      }
      if (sequence === searchSequenceRef.current) setLoading(false);
    }
  }, [currentUserId]);

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

  const startDirect = async (user: ApiPublicUser) => {
    setCreatingId(user.id);
    setError("");
    try {
      const conversation = await chatWaveApi.createPrivateConversation(user.id);
      onCreated(conversation.id);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось создать диалог",
      );
    } finally {
      setCreatingId(null);
    }
  };

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (creatingGroupRef.current) return;
    creatingGroupRef.current = true;
    setLoading(true);
    setError("");
    try {
      const conversation = await chatWaveApi.createGroup(
        groupName.trim(),
        groupDescription,
      );
      onCreated(conversation.id);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось создать группу",
      );
    } finally {
      creatingGroupRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="new-conversation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-conversation-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Закрыть">
          <X size={18} />
        </button>
        <span className="eyebrow">Новое общение</span>
        <h2 id="new-conversation-title">
          {mode === "direct" ? "Найти человека" : "Создать группу"}
        </h2>
        <p>
          {mode === "direct"
            ? "Начните вводить username — варианты появятся автоматически."
            : "Участников можно добавить после создания пространства."}
        </p>

        <div className="creation-tabs" role="tablist">
          <button
            type="button"
            className={mode === "direct" ? "active" : ""}
            onClick={() => {
              setMode("direct");
              setError("");
            }}
          >
            <UserRoundPlus size={17} /> Личный чат
          </button>
          <button
            type="button"
            className={mode === "group" ? "active" : ""}
            onClick={() => {
              setMode("group");
              setError("");
            }}
          >
            <UsersRound size={17} /> Группа
          </button>
        </div>

        {mode === "direct" ? (
          <>
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
              {results.map((user) => (
                <button
                  key={user.id}
                  className="people-result"
                  onClick={() => void startDirect(user)}
                  disabled={creatingId !== null}
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
                  <b>{creatingId === user.id ? "Создаём…" : "Написать"}</b>
                </button>
              ))}
              {searched && !results.length && !loading && (
                <div className="people-empty">
                  <Search size={23} />
                  <strong>Никого не нашли</strong>
                  <span>Проверьте username или попробуйте другой запрос.</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <form className="group-create-form" onSubmit={createGroup}>
            <label>
              Название
              <input
                autoFocus
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Команда продукта"
                minLength={1}
                maxLength={64}
                required
              />
            </label>
            <label>
              Описание
              <textarea
                value={groupDescription}
                onChange={(event) => setGroupDescription(event.target.value)}
                placeholder="О чём это пространство"
                maxLength={256}
                rows={3}
              />
            </label>
            <button className="primary-button" disabled={loading}>
              <UsersRound size={18} />
              {loading ? "Создаём…" : "Создать группу"}
            </button>
          </form>
        )}
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}
