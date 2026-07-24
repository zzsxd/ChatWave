"use client";

import { FormEvent } from "react";
import { Search, X } from "lucide-react";
import { Message } from "../models";

type MessageSearchProps = {
  query: string;
  results: Message[];
  searching: boolean;
  onQueryChange: (query: string) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  onOpenResult: (message: Message) => void;
};

export function MessageSearch({
  query,
  results,
  searching,
  onQueryChange,
  onSubmit,
  onClose,
  onOpenResult,
}: MessageSearchProps) {
  return (
    <form className="message-search" onSubmit={onSubmit}>
      <Search size={16} />
      <input
        autoFocus
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Поиск по текущему чату — минимум 3 символа"
        aria-label="Поиск по сообщениям"
      />
      <button type="submit" disabled={query.trim().length < 3 || searching}>
        {searching ? "Ищем…" : "Найти"}
      </button>
      <button type="button" aria-label="Закрыть поиск" onClick={onClose}>
        <X size={16} />
      </button>
      {results.length > 0 && (
        <div className="search-results">
          {results.map((message) => (
            <button
              type="button"
              key={message.id}
              onClick={() => onOpenResult(message)}
            >
              <strong>{message.author}</strong>
              <span>{message.text || message.attachment?.name}</span>
              <time>{message.time}</time>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
