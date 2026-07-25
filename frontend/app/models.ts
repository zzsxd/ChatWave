import { ApiMessage, ApiUser, chatWaveApi } from "./api";

export type Chat = {
  id: string;
  title: string;
  initials: string;
  preview: string;
  time: string;
  unread?: number;
  online?: boolean;
  muted?: boolean;
  accent: string;
  type: "group" | "direct";
  conversationId?: number;
  recipientId?: number;
  memberIds?: number[];
  memberRoles?: Record<number, string>;
  currentUserRole?: string;
  description: string;
  memberCount: number;
  onlineCount: number;
  avatarUrl?: string;
};

export type Message = {
  id: number;
  author: string;
  initials: string;
  time: string;
  text: string;
  own?: boolean;
  accent: string;
  avatarUrl?: string;
  reaction?: string;
  attachment?: { name: string; size: string };
  pending?: boolean;
  failed?: boolean;
  status?: ApiMessage["status"];
  edited?: boolean;
  clientMessageId?: string;
  replyToId?: number;
  messageType?: ApiMessage["type"];
  mediaMimeType?: string;
  encrypted?: boolean;
  callEvent?: {
    callId: number;
    outcome: "completed" | "missed" | "rejected" | "cancelled";
    duration: number;
    startedAt: string;
  };
  reactions?: Array<{ emoji: string; count: number; reacted: boolean }>;
  retry?: {
    kind: "text" | "media";
    content: string;
    clientMessageId: string;
    replyToId?: number;
    file?: File;
    isVoice?: boolean;
  };
};

const CALL_HISTORY_PREFIX = "__chatwave_call__:";

const parseCallEvent = (content: string | null): Message["callEvent"] => {
  if (!content?.startsWith(CALL_HISTORY_PREFIX)) return undefined;
  try {
    const value = JSON.parse(content.slice(CALL_HISTORY_PREFIX.length)) as {
      call_id?: unknown;
      outcome?: unknown;
      duration?: unknown;
      started_at?: unknown;
    };
    if (
      typeof value.call_id !== "number" ||
      !["completed", "missed", "rejected", "cancelled"].includes(
        String(value.outcome),
      ) ||
      typeof value.started_at !== "string"
    ) {
      return undefined;
    }
    return {
      callId: value.call_id,
      outcome: value.outcome as NonNullable<Message["callEvent"]>["outcome"],
      duration:
        typeof value.duration === "number" ? Math.max(0, value.duration) : 0,
      startedAt: value.started_at,
    };
  } catch {
    return undefined;
  }
};

export type Member = {
  initials: string;
  name: string;
  role: string;
  accent: string;
  online?: boolean;
  presenceText?: string;
  avatarUrl?: string;
};

export type HistoryState = {
  beforeId?: number;
  hasMore: boolean;
  loading: boolean;
};

export const formatFileSize = (bytes: number | null) => {
  if (!bytes) return "Файл";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const formatPresence = (
  online: boolean,
  lastOnline: string | null | undefined,
) => {
  if (online) return "в сети";
  if (!lastOnline) return "время посещения неизвестно";
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(lastOnline)
    ? lastOnline
    : `${lastOnline}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "не в сети";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const activityDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDifference = Math.round(
    (today.getTime() - activityDay.getTime()) / 86_400_000,
  );
  const time = date.toLocaleTimeString("ru", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (dayDifference === 0) return `последняя активность сегодня в ${time}`;
  if (dayDifference === 1) return `последняя активность вчера в ${time}`;
  return `последняя активность ${date.toLocaleDateString("ru", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" as const }),
  })} в ${time}`;
};

export const mapApiMessage = (
  message: ApiMessage,
  chat: Chat,
  currentUser: ApiUser,
  usersById: Record<number, ApiUser>,
): Message => {
  const own = message.sender_id === currentUser.id;
  const sender = usersById[message.sender_id];
  const callEvent = parseCallEvent(message.content);
  const callStartedAt = callEvent
    ? new Date(
        /(?:Z|[+-]\d\d:\d\d)$/.test(callEvent.startedAt)
          ? callEvent.startedAt
          : `${callEvent.startedAt}Z`,
      )
    : null;
  return {
    id: message.id,
    author: own ? "Вы" : sender?.nickname ?? chat.title,
    initials: own
      ? "Я"
      : (sender?.nickname ?? chat.initials).slice(0, 2).toUpperCase(),
    time: callStartedAt || message.created_at
      ? new Date(callStartedAt ?? message.created_at!).toLocaleTimeString("ru", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    text: callEvent
      ? callEvent.outcome === "completed"
        ? own
          ? "Исходящий звонок"
          : "Входящий звонок"
        : own
          ? callEvent.outcome === "cancelled"
            ? "Отменённый звонок"
            : "Звонок не состоялся"
          : "Пропущенный звонок"
      : message.content ?? (message.type === "text" ? "" : `[${message.type}]`),
    accent: own ? "blue" : chat.accent,
    avatarUrl: chatWaveApi.avatarUrl(
      own ? currentUser.avatar_name : sender?.avatar_name,
    ) ?? undefined,
    own,
    status: message.status,
    clientMessageId: message.client_message_id ?? undefined,
    replyToId: message.reply_to_id ?? undefined,
    messageType: message.type,
    mediaMimeType: message.file_content_type ?? undefined,
    encrypted: Boolean(message.encrypted_content),
    callEvent,
    reactions: Object.entries(
      message.reactions.reduce<Record<string, { count: number; reacted: boolean }>>(
        (result, reaction) => {
          const current = result[reaction.emoji] ?? {
            count: 0,
            reacted: false,
          };
          current.count += 1;
          current.reacted ||= reaction.user_id === currentUser.id;
          result[reaction.emoji] = current;
          return result;
        },
        {},
      ),
    ).map(([emoji, value]) => ({ emoji, ...value })),
    edited: Boolean(
      message.updated_at &&
        message.created_at &&
        message.updated_at !== message.created_at,
    ),
    attachment: message.file_content_name
      ? {
          name: message.original_file_name ?? `Вложение #${message.id}`,
          size: formatFileSize(message.file_size),
        }
      : undefined,
  };
};

export const mergeMessages = (current: Message[], incoming: Message[]) => {
  const byIdentity = new Map<string, Message>();
  [...current, ...incoming].forEach((message) => {
    const identity = message.clientMessageId
      ? `client:${message.clientMessageId}`
      : `id:${message.id}`;
    const existing = byIdentity.get(identity);
    byIdentity.set(
      identity,
      existing
        ? {
            ...existing,
            ...message,
            attachment: message.attachment ?? existing.attachment,
          }
        : message,
    );
  });
  return [...byIdentity.values()].sort((left, right) => {
    const leftOptimistic = left.id < 0;
    const rightOptimistic = right.id < 0;
    if (leftOptimistic !== rightOptimistic) return leftOptimistic ? 1 : -1;
    return leftOptimistic ? right.id - left.id : left.id - right.id;
  });
};
