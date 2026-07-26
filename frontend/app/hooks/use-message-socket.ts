"use client";

import {
  Dispatch,
  SetStateAction,
  useEffect,
  useRef,
} from "react";
import { ApiUser, MessageEvent, chatWaveApi } from "../api";
import {
  Chat,
  Message,
  mapApiMessage,
  mergeMessages,
  messagePreview,
} from "../models";
import { playMessageNotification } from "../notification-sounds";
import { decryptApiMessage } from "../e2ee/client";

type MessagesByChat = Record<string, Message[]>;
type TypingByConversation = Record<number, number[]>;

type UseMessageSocketOptions = {
  connectedUser: ApiUser | null;
  selectedChatId: string;
  chats: Chat[];
  users: Record<number, ApiUser>;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  setMessages: Dispatch<SetStateAction<MessagesByChat>>;
  setTyping: Dispatch<SetStateAction<TypingByConversation>>;
  onMissingConversation?: (
    conversationId: number,
  ) => Promise<{ chat: Chat; users: Record<number, ApiUser> } | null>;
};

export function useMessageSocket({
  connectedUser,
  selectedChatId,
  chats,
  users,
  setChats,
  setMessages,
  setTyping,
  onMissingConversation,
}: UseMessageSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const selectedChatRef = useRef(selectedChatId);
  const chatsRef = useRef(chats);
  const usersRef = useRef(users);
  const remoteTypingTimersRef = useRef<Record<string, number>>({});
  const pendingReceiptSignalsRef = useRef<object[]>([]);

  useEffect(() => {
    selectedChatRef.current = selectedChatId;
    chatsRef.current = chats;
    usersRef.current = users;
  }, [chats, selectedChatId, users]);

  useEffect(() => {
    if (!connectedUser) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let retryDelay = 1_000;

    const findChat = (conversationId: number) =>
      chatsRef.current.find(
        (chat) => chat.conversationId === conversationId,
      );

    const connect = () => {
      if (stopped) return;
      try {
        socket = chatWaveApi.messageSocket();
      } catch {
        return;
      }
      socket.onopen = () => {
        retryDelay = 1_000;
        socketRef.current = socket;
        pendingReceiptSignalsRef.current.splice(0).forEach((payload) => {
          socket?.send(JSON.stringify(payload));
        });
      };
      socket.onmessage = async (event) => {
        const payload = JSON.parse(event.data) as MessageEvent;
        if (
          payload.type === "message.created" ||
          payload.type === "message.updated"
        ) {
          let chat = findChat(payload.message.conversation_id);
          if (!chat && onMissingConversation) {
            const restored = await onMissingConversation(
              payload.message.conversation_id,
            );
            if (restored) {
              chat = restored.chat;
              usersRef.current = restored.users;
              chatsRef.current = [
                ...chatsRef.current.filter((item) => item.id !== chat!.id),
                chat,
              ];
            }
          }
          if (!chat) return;
          const decryptedMessage = await decryptApiMessage(
            connectedUser.id,
            payload.message,
          );
          const mapped = mapApiMessage(
            decryptedMessage,
            chat,
            connectedUser,
            usersRef.current,
          );
          setMessages((current) => ({
            ...current,
            [chat.id]: mergeMessages(current[chat.id] ?? [], [mapped]),
          }));
          setChats((current) =>
            current.map((item) =>
              item.id === chat.id
                ? {
                    ...item,
                    preview: messagePreview(mapped),
                    time: mapped.time,
                    lastActivityAt:
                      payload.type === "message.created"
                        ? payload.message.created_at
                          ? new Date(payload.message.created_at).getTime()
                          : Date.now()
                        : item.lastActivityAt,
                    unread:
                      payload.type === "message.created" &&
                      payload.message.sender_id !== connectedUser.id &&
                      selectedChatRef.current !== chat.id
                        ? (item.unread ?? 0) + 1
                        : item.unread,
                  }
                : item,
            ),
          );
          if (
            payload.type === "message.created" &&
            payload.message.sender_id !== connectedUser.id
          ) {
            if (!mapped.callEvent) playMessageNotification();
            socket?.send(
              JSON.stringify({
                type:
                  selectedChatRef.current === chat.id
                    ? "message.read"
                    : "message.delivered",
                message_id: payload.message.id,
              }),
            );
          }
          return;
        }

        if (payload.type === "message.deleted") {
          const chat = findChat(payload.conversation_id);
          if (!chat) return;
          setMessages((current) => ({
            ...current,
            [chat.id]: (current[chat.id] ?? []).filter(
              (message) => !payload.message_ids.includes(message.id),
            ),
          }));
          return;
        }

        if (
          payload.type === "message.status" ||
          payload.type === "message.statuses"
        ) {
          const chat = findChat(payload.conversation_id);
          if (!chat) return;
          const statuses =
            payload.type === "message.status"
              ? new Map([[payload.message_id, payload.status]])
              : new Map(
                  payload.statuses.map((item) => [
                    item.message_id,
                    item.status,
                  ]),
                );
          setMessages((current) => {
            let changed = false;
            const messages = (current[chat.id] ?? []).map((message) => {
              const status = statuses.get(message.id);
              if (!status || status === message.status) return message;
              changed = true;
              return { ...message, status };
            });
            return changed ? { ...current, [chat.id]: messages } : current;
          });
          return;
        }

        if (payload.type === "typing.start" || payload.type === "typing.stop") {
          const timerKey = `${payload.conversation_id}:${payload.user_id}`;
          const existing = remoteTypingTimersRef.current[timerKey];
          if (existing) window.clearTimeout(existing);
          setTyping((current) => {
            const currentUsers = current[payload.conversation_id] ?? [];
            const nextUsers =
              payload.type === "typing.start"
                ? [...new Set([...currentUsers, payload.user_id])]
                : currentUsers.filter((userId) => userId !== payload.user_id);
            return { ...current, [payload.conversation_id]: nextUsers };
          });
          if (payload.type === "typing.start") {
            remoteTypingTimersRef.current[timerKey] = window.setTimeout(() => {
              setTyping((current) => ({
                ...current,
                [payload.conversation_id]: (
                  current[payload.conversation_id] ?? []
                ).filter((userId) => userId !== payload.user_id),
              }));
              delete remoteTypingTimersRef.current[timerKey];
            }, 5_500);
          }
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        reconnectTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15_000);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
      socketRef.current = null;
      Object.values(remoteTypingTimersRef.current).forEach((timer) =>
        window.clearTimeout(timer),
      );
      remoteTypingTimersRef.current = {};
    };
  }, [
    connectedUser,
    onMissingConversation,
    setChats,
    setMessages,
    setTyping,
  ]);

  return (payload: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
      return;
    }
    const type = (payload as { type?: unknown }).type;
    if (
      type === "message.read" ||
      type === "message.delivered" ||
      type === "message.read_batch" ||
      type === "message.delivered_batch"
    ) {
      const signalKey =
        "message_id" in payload
          ? (payload as { message_id?: unknown }).message_id
          : JSON.stringify(
              (payload as { message_ids?: unknown }).message_ids ?? [],
            );
      const duplicate = pendingReceiptSignalsRef.current.some(
        (item) =>
          (item as { type?: unknown }).type === type &&
          ("message_id" in item
            ? (item as { message_id?: unknown }).message_id
            : JSON.stringify(
                (item as { message_ids?: unknown }).message_ids ?? [],
              )) === signalKey,
      );
      if (!duplicate) pendingReceiptSignalsRef.current.push(payload);
    }
  };
}
