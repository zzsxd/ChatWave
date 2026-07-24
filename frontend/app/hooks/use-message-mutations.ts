"use client";

import { Dispatch, SetStateAction } from "react";
import { ApiUser, chatWaveApi } from "../api";
import { Chat, Message, mapApiMessage, mergeMessages } from "../models";

type UseMessageMutationsOptions = {
  chat: Chat;
  user: ApiUser | null;
  users: Record<number, ApiUser>;
  setMessages: Dispatch<SetStateAction<Record<string, Message[]>>>;
  setNotice: (notice: string) => void;
  closeReactionPicker: () => void;
};

export function useMessageMutations({
  chat,
  user,
  users,
  setMessages,
  setNotice,
  closeReactionPicker,
}: UseMessageMutationsOptions) {
  const react = async (message: Message, emoji: string) => {
    closeReactionPicker();
    if (!chat.conversationId || !user) return;
    try {
      const saved = await chatWaveApi.reactToMessage(message.id, emoji);
      const updated = mapApiMessage(saved, chat, user, users);
      setMessages((current) => ({
        ...current,
        [chat.id]: mergeMessages(current[chat.id] ?? [], [updated]),
      }));
    } catch {
      setNotice("Не удалось обновить реакцию.");
    }
  };

  const remove = async (message: Message) => {
    if (
      !chat.conversationId ||
      !user ||
      !window.confirm("Удалить это сообщение для всех участников?")
    ) {
      return;
    }
    try {
      await chatWaveApi.deleteMessage(message.id);
      setMessages((current) => ({
        ...current,
        [chat.id]: (current[chat.id] ?? []).filter(
          (item) => item.id !== message.id,
        ),
      }));
    } catch {
      setNotice("Не удалось удалить сообщение.");
    }
  };

  const removeMany = async (messageIds: number[]) => {
    if (
      !chat.conversationId ||
      !user ||
      messageIds.length === 0 ||
      !window.confirm(
        `Удалить выбранные сообщения (${messageIds.length}) для всех участников?`,
      )
    ) {
      return false;
    }
    try {
      await chatWaveApi.deleteMessages(messageIds);
      const selected = new Set(messageIds);
      setMessages((current) => ({
        ...current,
        [chat.id]: (current[chat.id] ?? []).filter(
          (item) => !selected.has(item.id),
        ),
      }));
      setNotice(`Удалено сообщений: ${messageIds.length}.`);
      return true;
    } catch {
      setNotice("Не удалось удалить выбранные сообщения.");
      return false;
    }
  };

  const download = async (message: Message) => {
    if (!chat.conversationId || !user) return;
    try {
      const blob = await chatWaveApi.downloadMedia(message.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = message.attachment?.name ?? `message-${message.id}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setNotice("Не удалось скачать вложение.");
    }
  };

  return { react, remove, removeMany, download };
}
