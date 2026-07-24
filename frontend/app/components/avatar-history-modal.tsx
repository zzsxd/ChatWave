"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  RotateCcw,
  X,
} from "lucide-react";
import { ApiAvatarHistoryItem, chatWaveApi } from "../api";

export function AvatarHistoryModal({
  userId,
  canRestore = false,
  onClose,
  onRestored,
}: {
  userId: number;
  canRestore?: boolean;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const [items, setItems] = useState<ApiAvatarHistoryItem[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void chatWaveApi
      .avatarHistory(userId)
      .then((history) => {
        if (!active) return;
        setItems(history);
        const currentIndex = history.findIndex((item) => item.current);
        setIndex(currentIndex >= 0 ? currentIndex : 0);
      })
      .catch(() => active && setError("Не удалось загрузить историю"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") {
        setIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "ArrowRight") {
        setIndex((current) => Math.min(items.length - 1, current + 1));
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keyboard);
    };
  }, [items.length, onClose]);

  const selected = items[index];
  const restore = async () => {
    if (!selected || selected.current) return;
    setRestoring(true);
    setError("");
    try {
      await chatWaveApi.restoreAvatar(selected.avatar_name);
      setItems((current) =>
        current.map((item) => ({
          ...item,
          current: item.avatar_name === selected.avatar_name,
        })),
      );
      onRestored?.();
    } catch {
      setError("Не удалось вернуть фотографию");
    } finally {
      setRestoring(false);
    }
  };

  return createPortal(
    <div className="avatar-history-backdrop" onMouseDown={onClose}>
      <section
        className="avatar-history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="История фотографий профиля"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span>
            <History size={17} />
            Фотографии профиля
          </span>
          <button onClick={onClose} aria-label="Закрыть">
            <X size={19} />
          </button>
        </header>
        <div className="avatar-history-stage">
          {loading ? (
            <span className="media-loader" />
          ) : selected ? (
            <img
              src={chatWaveApi.avatarUrl(selected.avatar_name) ?? ""}
              alt="Фотография профиля"
            />
          ) : (
            <div className="avatar-history-empty">
              <History size={30} />
              <strong>История пока пуста</strong>
            </div>
          )}
          {items.length > 1 && (
            <>
              <button
                className="avatar-history-arrow previous"
                onClick={() => setIndex((current) => Math.max(0, current - 1))}
                disabled={index === 0}
                aria-label="Предыдущая фотография"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                className="avatar-history-arrow next"
                onClick={() =>
                  setIndex((current) =>
                    Math.min(items.length - 1, current + 1),
                  )
                }
                disabled={index === items.length - 1}
                aria-label="Следующая фотография"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}
        </div>
        {selected && (
          <footer>
            <span>
              {index + 1} из {items.length} ·{" "}
              {new Date(selected.created_at).toLocaleDateString("ru")}
            </span>
            {selected.current ? (
              <b>
                <Check size={14} /> Текущая
              </b>
            ) : canRestore ? (
              <button onClick={() => void restore()} disabled={restoring}>
                <RotateCcw size={15} />
                {restoring ? "Возвращаем…" : "Сделать основной"}
              </button>
            ) : null}
          </footer>
        )}
        {error && <div className="auth-error">{error}</div>}
      </section>
    </div>,
    document.body,
  );
}
