export type ApiConversation = {
  id: number;
  type: "private" | "group";
  name: string | null;
  description: string | null;
  avatar_name: string | null;
  members: Array<{ user_id: number; user_role: string }>;
};

export type ApiMessage = {
  id: number;
  conversation_id: number;
  sender_id: number;
  status: "created" | "sent" | "delivered" | "read";
  type: "text" | "image" | "video" | "audio" | "file" | "voice";
  content: string | null;
  file_content_name: string | null;
  file_content_type: string | null;
  file_size: number | null;
  original_file_name: string | null;
  client_message_id: string | null;
  reply_to_id: number | null;
  encryption_algorithm: string | null;
  encrypted_content: Record<string, unknown> | null;
  reactions: Array<{ user_id: number; emoji: string }>;
  created_at: string | null;
  updated_at: string | null;
};

export type E2EESyncResponse = {
  next_batch: string;
  to_device: { events: Array<Record<string, unknown>> };
  device_lists: { changed: string[]; left: string[] };
  device_one_time_keys_count: Record<string, number>;
  device_unused_fallback_key_types: string[];
};

export type E2EEKeyBackup = {
  version: number;
  encrypted_data: string;
  updated_at: string;
};

export type ApiUnreadMessage = {
  id: number;
  user_id: number;
  conversation_id: number;
  message_id: number | null;
  call_id: number | null;
};

export type ApiIceServerConfig = {
  ice_servers: RTCIceServer[];
  expires_at: number;
};

export type MessageEvent =
  | { type: "message.created" | "message.updated"; message: ApiMessage }
  | {
      type: "message.deleted";
      conversation_id: number;
      message_ids: number[];
    }
  | {
      type: "message.status";
      conversation_id: number;
      message_id: number;
      status: ApiMessage["status"];
    }
  | {
      type: "message.statuses";
      conversation_id: number;
      statuses: Array<{
        message_id: number;
        status: ApiMessage["status"];
      }>;
    }
  | {
      type: "typing.start" | "typing.stop";
      conversation_id: number;
      user_id: number;
    }
  | { type: "message.error"; code: string };

export type ApiUser = {
  id: number;
  username?: string;
  nickname: string;
  bio: string | null;
  avatar_name: string | null;
  avatar_type?: string | null;
  birthday?: string | null;
  created_at?: string;
  updated_at?: string | null;
};

export type ApiPublicUser = {
  id: number;
  nickname: string;
  bio: string | null;
  avatar_name: string | null;
  avatar_type?: string | null;
};

export type ApiAvatarHistoryItem = {
  avatar_name: string;
  avatar_type: string;
  created_at: string;
  current: boolean;
};

export type ApiUserOnline = {
  user_id: number;
  last_online: string | null;
  online: boolean;
};

const DEFAULT_API_URL =
  process.env.NEXT_PUBLIC_CHATWAVE_API_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

class ChatWaveApi {
  private token: string | null = null;
  private apiUrl = DEFAULT_API_URL;

  constructor() {
    if (typeof window !== "undefined") {
      this.token = sessionStorage.getItem("chatwave_token");
      this.apiUrl =
        sessionStorage.getItem("chatwave_api_url") ?? DEFAULT_API_URL;
    }
  }

  get connected() {
    return Boolean(this.token);
  }

  avatarUrl(avatarName: string | null | undefined) {
    return avatarName
      ? `${this.apiUrl}/users/avatar/${encodeURIComponent(avatarName)}`
      : null;
  }

  clearSession() {
    this.token = null;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("chatwave_token");
    }
  }

  callSocket() {
    if (!this.token) throw new Error("Сначала войдите в ChatWave");
    const socketUrl = `${this.apiUrl.replace(/^http/, "ws")}/calls/ws`;
    return new WebSocket(socketUrl, ["bearer", this.token]);
  }

  messageSocket() {
    if (!this.token) throw new Error("Сначала войдите в ChatWave");
    const socketUrl = `${this.apiUrl.replace(/^http/, "ws")}/users/ws/messages`;
    return new WebSocket(socketUrl, ["bearer", this.token]);
  }

  onlineSocket() {
    if (!this.token) throw new Error("Сначала войдите в ChatWave");
    const socketUrl = `${this.apiUrl.replace(/^http/, "ws")}/users/ws/online`;
    return new WebSocket(socketUrl, ["bearer", this.token]);
  }

  configureServer(value: string) {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Адрес API должен начинаться с http:// или https://");
    }
    if (
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      url.protocol !== "https:"
    ) {
      throw new Error("Для защищённого сайта API также должен использовать HTTPS");
    }
    this.apiUrl = url.toString().replace(/\/$/, "");
    sessionStorage.setItem("chatwave_api_url", this.apiUrl);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      if (response.status === 401) this.clearSession();
      const detail = payload?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail[0]?.msg
            : null;
      throw new Error(message ?? `Ошибка API: ${response.status}`);
    }
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  async login(username: string, password: string, serverUrl?: string) {
    if (serverUrl) this.configureServer(serverUrl);
    const body = new URLSearchParams({ username, password });
    const response = await fetch(`${this.apiUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error("Неверный логин или пароль");
    const payload = (await response.json()) as { access_token: string };
    this.token = payload.access_token;
    sessionStorage.setItem("chatwave_token", payload.access_token);
    return this.me();
  }

  async signup(nickname: string, username: string, password: string) {
    await this.request<void>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ nickname, username, password }),
    });
    return this.login(username, password);
  }

  async restoreSession() {
    if (typeof window !== "undefined") {
      this.token = sessionStorage.getItem("chatwave_token");
      this.apiUrl =
        sessionStorage.getItem("chatwave_api_url") ?? DEFAULT_API_URL;
    }
    if (!this.token) return null;
    try {
      return await this.me();
    } catch {
      this.clearSession();
      return null;
    }
  }

  async logout() {
    try {
      await this.request<void>("/auth/logout", { method: "POST" });
    } finally {
      this.clearSession();
    }
  }

  me() {
    return this.request<ApiUser>("/users/me");
  }

  updateProfile(profile: {
    nickname?: string;
    username?: string;
    bio?: string;
    birthday?: string;
  }) {
    return this.request<void>("/users/me", {
      method: "PATCH",
      body: JSON.stringify(profile),
    });
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.request<void>("/users/me/password", {
      method: "PUT",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  }

  uploadAvatar(file: File) {
    const body = new FormData();
    body.append("avatar", file);
    return this.request<void>("/users/me/avatar", {
      method: "PUT",
      body,
    });
  }

  deleteAvatar() {
    return this.request<void>("/users/me/avatar", { method: "DELETE" });
  }

  avatarHistory(userId: number) {
    return this.request<ApiAvatarHistoryItem[]>(
      `/users/${userId}/avatar-history`,
    );
  }

  restoreAvatar(avatarName: string) {
    return this.request<void>(
      `/users/me/avatar/${encodeURIComponent(avatarName)}`,
      { method: "PUT" },
    );
  }

  conversations() {
    return this.request<ApiConversation[]>("/users/conversations");
  }

  users(userIds: number[]) {
    const params = new URLSearchParams();
    userIds.forEach((userId) => params.append("users_ids", String(userId)));
    return this.request<ApiUser[]>(`/users?${params.toString()}`);
  }

  searchUsers(searchQuery: string, limit = 30) {
    const params = new URLSearchParams({
      search_query: searchQuery,
      limit: String(limit),
    });
    return this.request<ApiPublicUser[]>(`/users/search?${params.toString()}`);
  }

  createPrivateConversation(recipientId: number) {
    const params = new URLSearchParams({ recipient_id: String(recipientId) });
    return this.request<ApiConversation>(`/conversations/chat?${params}`, {
      method: "POST",
    });
  }

  createGroup(name: string, description?: string) {
    return this.request<ApiConversation>("/conversations/group", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description?.trim() || null,
      }),
    });
  }

  addGroupMembers(groupId: number, userIds: number[]) {
    const params = new URLSearchParams();
    userIds.forEach((userId) => params.append("users_ids", String(userId)));
    return this.request<void>(
      `/conversations/${groupId}/members?${params.toString()}`,
      { method: "POST" },
    );
  }

  unreadMessages() {
    return this.request<ApiUnreadMessage[]>("/users/messages/unread?limit=100");
  }

  onlineStatuses() {
    return this.request<ApiUserOnline[]>("/users/online");
  }

  messages(conversationId: number, beforeId?: number, limit = 50) {
    const params = new URLSearchParams({ limit: String(limit), offset: "0" });
    if (beforeId) params.set("before_id", String(beforeId));
    return this.request<ApiMessage[]>(
      `/conversations/${conversationId}/messages?${params.toString()}`,
    );
  }

  lastMessage(conversationId: number) {
    return this.request<ApiMessage>(
      `/conversations/${conversationId}/messages/last`,
    );
  }

  searchMessages(conversationId: number, query: string) {
    const params = new URLSearchParams({ search_query: query, limit: "50" });
    return this.request<ApiMessage[]>(
      `/conversations/${conversationId}/messages/search?${params.toString()}`,
    );
  }

  conversationMedia(
    conversationId: number,
    kind: "media" | "files",
  ) {
    return this.request<ApiMessage[]>(
      `/conversations/${conversationId}/media?kind=${kind}&limit=100`,
    );
  }

  pinnedMessages(conversationId: number) {
    return this.request<ApiMessage[]>(
      `/conversations/${conversationId}/pinned`,
    );
  }

  iceServers() {
    return this.request<ApiIceServerConfig>("/calls/ice-servers");
  }

  disconnectCall(callId: number) {
    return this.request<void>(`/calls/${callId}/disconnect`, {
      method: "POST",
      keepalive: true,
    });
  }

  sendText(
    conversationId: number,
    content: string,
    clientMessageId: string,
    replyToId?: number,
  ) {
    return this.request<ApiMessage>(`/conversations/${conversationId}/text`, {
      method: "POST",
      body: JSON.stringify({
        content,
        client_message_id: clientMessageId,
        reply_to_id: replyToId,
      }),
    });
  }

  sendEncrypted(
    conversationId: number,
    encryptedContent: Record<string, unknown>,
    clientMessageId: string,
    replyToId?: number,
  ) {
    return this.request<ApiMessage>(
      `/conversations/${conversationId}/encrypted`,
      {
        method: "POST",
        body: JSON.stringify({
          algorithm: "m.megolm.v1.aes-sha2",
          encrypted_content: encryptedContent,
          client_message_id: clientMessageId,
          reply_to_id: replyToId,
        }),
      },
    );
  }

  e2eeUpload(
    deviceId: string,
    deviceSecret: string,
    body: Record<string, unknown>,
  ) {
    return this.request<Record<string, unknown>>("/e2ee/keys/upload", {
      method: "POST",
      headers: {
        "X-ChatWave-Device-ID": deviceId,
        "X-ChatWave-Device-Secret": deviceSecret,
      },
      body: JSON.stringify(body),
    });
  }

  e2eeQuery(body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("/e2ee/keys/query", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  e2eeClaim(body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("/e2ee/keys/claim", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  e2eeSendToDevice(
    eventType: string,
    transactionId: string,
    body: Record<string, unknown>,
  ) {
    return this.request<Record<string, never>>(
      `/e2ee/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  }

  e2eeSync(deviceId: string, deviceSecret: string, since = "0") {
    const params = new URLSearchParams({ since, limit: "500" });
    return this.request<E2EESyncResponse>(`/e2ee/sync?${params}`, {
      headers: {
        "X-ChatWave-Device-ID": deviceId,
        "X-ChatWave-Device-Secret": deviceSecret,
      },
    });
  }

  e2eeAcknowledge(
    deviceId: string,
    deviceSecret: string,
    upTo: string,
  ) {
    return this.request<void>(`/e2ee/sync/${encodeURIComponent(upTo)}/ack`, {
      method: "POST",
      headers: {
        "X-ChatWave-Device-ID": deviceId,
        "X-ChatWave-Device-Secret": deviceSecret,
      },
    });
  }

  e2eeSaveBackup(encryptedData: string) {
    return this.request<void>("/e2ee/backup", {
      method: "PUT",
      body: JSON.stringify({ version: 1, encrypted_data: encryptedData }),
    });
  }

  e2eeBackup() {
    return this.request<E2EEKeyBackup>("/e2ee/backup");
  }

  sendMedia(
    conversationId: number,
    file: File,
    caption = "",
    isVoice = false,
    clientMessageId?: string,
    replyToId?: number,
  ) {
    const body = new FormData();
    body.append("file", file);
    if (caption) body.append("caption", caption);
    if (clientMessageId) body.append("client_message_id", clientMessageId);
    if (replyToId) body.append("reply_to_id", String(replyToId));
    const params = new URLSearchParams({
      is_voice_message: String(isVoice),
    });
    return this.request<ApiMessage>(
      `/conversations/${conversationId}/media?${params.toString()}`,
      { method: "POST", body },
    );
  }

  updateMessage(messageId: number, content: string) {
    return this.request<ApiMessage>(`/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
  }

  deleteMessage(messageId: number) {
    return this.deleteMessages([messageId]);
  }

  deleteMessages(messageIds: number[]) {
    const params = new URLSearchParams();
    messageIds.forEach((messageId) =>
      params.append("messages_ids", String(messageId)),
    );
    return this.request<void>(`/messages?${params.toString()}`, {
      method: "DELETE",
    });
  }

  reactToMessage(messageId: number, emoji: string) {
    return this.request<ApiMessage>(`/messages/${messageId}/reaction`, {
      method: "PUT",
      body: JSON.stringify({ emoji }),
    });
  }

  pinMessage(messageId: number) {
    return this.request<void>(`/messages/${messageId}/pin`, { method: "PUT" });
  }

  unpinMessage(messageId: number) {
    return this.request<void>(`/messages/${messageId}/pin`, {
      method: "DELETE",
    });
  }

  async downloadMedia(messageId: number) {
    const response = await fetch(`${this.apiUrl}/messages/${messageId}/media`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    if (response.status === 401) this.clearSession();
    if (!response.ok) throw new Error(`Ошибка загрузки: ${response.status}`);
    return response.blob();
  }
}

export const chatWaveApi = new ChatWaveApi();
