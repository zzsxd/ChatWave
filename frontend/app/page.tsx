"use client";

import {
  AtSign,
  Info,
  ListChecks,
  LogOut,
  Maximize2,
  Menu,
  MessageCircleMore,
  Mic,
  MicOff,
  Minus,
  Minimize2,
  MoonStar,
  Phone,
  PhoneOff,
  Pin,
  Plus,
  Search,
  ScreenShare,
  ScreenShareOff,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
  Video,
  VideoOff,
  Volume2,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  type RefObject,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiMessage, ApiUser, chatWaveApi } from "./api";
import { CallMedia, CallPhase, useCall } from "./calls";
import { useUiState } from "./hooks/use-ui-state";
import { ChatSidebar } from "./components/chat-sidebar";
import { ChatDetails } from "./components/chat-details";
import { MessageComposer } from "./components/message-composer";
import { MessageFeed } from "./components/message-feed";
import { useVoiceRecorder } from "./hooks/use-voice-recorder";
import { useMessageSocket } from "./hooks/use-message-socket";
import { usePresence } from "./hooks/use-presence";
import { MessageSearch } from "./components/message-search";
import { AuthScreen } from "./components/auth-screen";
import { NewConversationModal } from "./components/new-conversation-modal";
import { AddGroupMembersModal } from "./components/add-group-members-modal";
import { ProfileSettingsModal } from "./components/profile-settings-modal";
import { loadAccountWorkspace } from "./account-workspace";
import { useMessageMutations } from "./hooks/use-message-mutations";
import {
  optimisticMediaMessage,
  optimisticTextMessage,
} from "./optimistic-messages";
import {
  Chat,
  HistoryState,
  Member,
  Message,
  formatFileSize,
  formatPresence,
  mapApiMessage,
  mergeMessages,
} from "./models";
import { initializeNotificationSounds } from "./notification-sounds";

const PAGE_SIZE = 50;
const EMPTY_CHAT: Chat = {
  id: "empty",
  title: "ChatWave",
  initials: "CW",
  preview: "Создайте первый диалог",
  time: "",
  accent: "blue",
  type: "group",
  description: "Ваше пространство для общения",
  memberCount: 1,
  onlineCount: 1,
};

const iconButton = (
  label: string,
  icon: React.ReactNode,
  className = "",
  onClick?: () => void,
  disabled = false,
) => (
  <button
    className={`icon-button ${className}`}
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
  >
    {icon}
  </button>
);

export default function Home() {
  const queryClient = useQueryClient();
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const [chatItems, setChatItems] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState("empty");
  const [messagesByChat, setMessagesByChat] =
    useState<Record<string, Message[]>>({});
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const {
    query,
    filter,
    navMode,
    detailsOpen,
    mobileChatsOpen: mobileChats,
    theme,
    profileOpen,
    setQuery,
    setFilter,
    setNavigation,
    setDetailsOpen,
    setMobileChatsOpen: setMobileChats,
    setTheme,
    setProfileOpen,
  } = useUiState();
  const [connectedUser, setConnectedUser] = useState<ApiUser | null>(null);
  const [authState, setAuthState] = useState<
    "checking" | "anonymous" | "authenticated"
  >("checking");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [detailsRevision, setDetailsRevision] = useState(0);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [apiUsers, setApiUsers] = useState<Record<number, ApiUser>>({});
  const [historyByChat, setHistoryByChat] =
    useState<Record<string, HistoryState>>({});
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<number | null>(null);
  const [messageSelectionOpen, setMessageSelectionOpen] = useState(false);
  const [messageSelectionChatId, setMessageSelectionChatId] = useState<
    string | null
  >(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
  const messageSelectionActive =
    messageSelectionOpen && messageSelectionChatId === selectedChat;
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [messageSearchResults, setMessageSearchResults] = useState<Message[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [typingByConversation, setTypingByConversation] =
    useState<Record<number, number[]>>({});
  const apiUsersRef = useRef(apiUsers);
  const typingStopTimerRef = useRef<number | null>(null);
  const typingRenewTimerRef = useRef<number | null>(null);
  const typingConversationRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const optimisticIdRef = useRef(-1);
  const sessionRestoreStartedRef = useRef(false);
  const connectAccountRef = useRef<
    ((user: ApiUser) => Promise<void>) | null
  >(null);
  const call = useCall(Boolean(connectedUser));
  const presenceByUser = usePresence(connectedUser);
  const sendMessageSignal = useMessageSocket({
    connectedUser,
    selectedChatId: selectedChat,
    chats: chatItems,
    users: apiUsers,
    setChats: setChatItems,
    setMessages: setMessagesByChat,
    setTyping: setTypingByConversation,
  });

  useEffect(() => initializeNotificationSounds(), []);

  useEffect(() => {
    apiUsersRef.current = apiUsers;
  }, [apiUsers]);

  useEffect(
    () => () => {
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
      }
      if (typingRenewTimerRef.current) {
        window.clearInterval(typingRenewTimerRef.current);
      }
      typingConversationRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3_500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const displayChatItems = useMemo(
    () =>
      chatItems.map((chat) => {
        const onlineMemberIds = (chat.memberIds ?? []).filter(
          (userId) =>
            userId === connectedUser?.id || presenceByUser[userId]?.online,
        );
        return {
          ...chat,
          online:
            chat.type === "direct"
              ? Boolean(
                  chat.recipientId &&
                    presenceByUser[chat.recipientId]?.online,
                )
              : chat.online,
          onlineCount:
            chat.type === "group"
              ? onlineMemberIds.length
              : chat.onlineCount,
        };
      }),
    [chatItems, connectedUser?.id, presenceByUser],
  );

  const visibleChats = useMemo(
    () =>
      displayChatItems.filter(
        (chat) =>
          (filter === "all" || chat.unread) &&
          (navMode === "messages" ||
            (navMode === "groups" && chat.type === "group") ||
            (navMode === "mentions" && chat.unread)) &&
          `${chat.title} ${chat.preview}`
            .toLocaleLowerCase("ru")
            .includes(query.toLocaleLowerCase("ru")),
      ),
    [displayChatItems, filter, navMode, query],
  );

  const activeChat =
    displayChatItems.find((chat) => chat.id === selectedChat) ??
    displayChatItems[0] ??
    EMPTY_CHAT;
  const unreadChatsCount = chatItems.filter((chat) => chat.unread).length;
  const activeMessages = messagesByChat[activeChat.id] ?? [];
  const editingMessage = activeMessages.find(
    (message) => message.id === editingMessageId,
  );
  const replyingMessage = activeMessages.find(
    (message) => message.id === replyingToId,
  );
  const activeMembers = (activeChat.memberIds ?? []).reduce<Member[]>(
    (members, userId, index) => {
      const user = apiUsers[userId];
      if (!user) return members;
      const presence = presenceByUser[userId];
      const online = user.id === connectedUser?.id || Boolean(presence?.online);
      members.push({
        initials: user.nickname.slice(0, 2).toUpperCase(),
        name: user.id === connectedUser?.id ? `${user.nickname} · вы` : user.nickname,
        role:
          activeChat.type === "direct"
            ? user.bio || ""
            : ({
                creator: "Создатель",
                admin: "Администратор",
                member: "Участник",
              }[activeChat.memberRoles?.[userId] ?? "member"] ??
              user.bio ??
              "Участник"),
        accent: ["blue", "violet", "cyan", "green"][index % 4],
        online,
        presenceText:
          user.id === connectedUser?.id
            ? "в сети"
            : formatPresence(online, presence?.last_online),
        avatarUrl: chatWaveApi.avatarUrl(user.avatar_name) ?? undefined,
      });
      return members;
    },
    [],
  );
  const callChat = call.conversationId
    ? chatItems.find((chat) => chat.conversationId === call.conversationId)
    : activeChat;
  const activeTypingUsers = activeChat.conversationId
    ? (typingByConversation[activeChat.conversationId] ?? [])
        .map((userId) => apiUsers[userId]?.nickname)
        .filter(Boolean)
    : [];
  const activeRecipientPresence = activeChat.recipientId
    ? presenceByUser[activeChat.recipientId]
    : undefined;
  const activePresenceText =
    activeChat.type === "direct"
      ? formatPresence(
          Boolean(activeRecipientPresence?.online),
          activeRecipientPresence?.last_online,
        )
      : `${activeChat.memberCount} участников · ${activeChat.onlineCount} в сети`;

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase("ru") === "f" &&
        connectedUser &&
        activeChat.conversationId
      ) {
        event.preventDefault();
        setMessageSearchOpen(true);
        return;
      }
      if (event.key === "Escape" && messageSearchOpen) {
        setMessageSearchOpen(false);
        setMessageSearchQuery("");
        setMessageSearchResults([]);
      }
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [activeChat.conversationId, connectedUser, messageSearchOpen]);
  const voiceRecorder = useVoiceRecorder({
    onRecorded: (file) => void uploadFile(file, true),
    onError: setNotice,
  });
  const messageMutations = useMessageMutations({
    chat: activeChat,
    user: connectedUser,
    users: apiUsers,
    setMessages: setMessagesByChat,
    setNotice,
    closeReactionPicker: () => setReactionPickerFor(null),
  });

  const mapApiMessages = (
    apiMessages: ApiMessage[],
    chat: Chat,
    currentUser: ApiUser,
  ): Message[] =>
    apiMessages
      .slice()
      .reverse()
      .map((message) =>
        mapApiMessage(message, chat, currentUser, apiUsersRef.current),
      );

  const selectChat = async (chat: Chat) => {
    if (activeChat.conversationId) {
      sendMessageSignal({
        type: "typing.stop",
        conversation_id: activeChat.conversationId,
      });
    }
    typingConversationRef.current = null;
    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (typingRenewTimerRef.current) {
      window.clearInterval(typingRenewTimerRef.current);
      typingRenewTimerRef.current = null;
    }
    setSelectedChat(chat.id);
    setDraft("");
    setEditingMessageId(null);
    setReplyingToId(null);
    setReactionPickerFor(null);
    setMessageSearchOpen(false);
    setMessageSearchQuery("");
    setMessageSearchResults([]);
    setAddMembersOpen(false);
    setMobileChats(false);
    setChatItems((current) =>
      current.map((item) =>
        item.id === chat.id ? { ...item, unread: undefined } : item,
      ),
    );
    if (!chat.conversationId || !connectedUser) return;
    try {
      const apiMessages = await chatWaveApi.messages(chat.conversationId);
      setMessagesByChat((current) => ({
        ...current,
        [chat.id]: mergeMessages(
          mapApiMessages(apiMessages, chat, connectedUser),
          current[chat.id] ?? [],
        ),
      }));
      setHistoryByChat((current) => ({
        ...current,
        [chat.id]: {
          beforeId: apiMessages.at(-1)?.id,
          hasMore: apiMessages.length === PAGE_SIZE,
          loading: false,
        },
      }));
      apiMessages
        .filter((message) => message.sender_id !== connectedUser.id)
        .forEach((message) =>
          sendMessageSignal({
            type: "message.read",
            message_id: message.id,
          }),
        );
    } catch {
      setNotice("Не удалось загрузить сообщения. Проверьте соединение с API.");
    }
  };

  const switchNavigation = (
    mode: "messages" | "groups" | "mentions",
  ) => {
    setNavigation(mode);
    const firstMatch = chatItems.find(
      (chat) =>
        mode === "messages" ||
        (mode === "groups" && chat.type === "group") ||
        (mode === "mentions" && chat.unread),
    );
    if (firstMatch) {
      setSelectedChat(firstMatch.id);
      setDraft("");
    }
  };

  const refreshWorkspace = async (
    user: ApiUser,
    preferredConversationId?: number,
  ) => {
    await queryClient.invalidateQueries({ queryKey: ["conversations", user.id] });
    const workspace = await loadAccountWorkspace(user, queryClient);
    setApiUsers(workspace.users);
    apiUsersRef.current = workspace.users;
    setChatItems(workspace.chats);

    const selected =
      workspace.chats.find(
        (chat) => chat.conversationId === preferredConversationId,
      ) ?? workspace.chats[0];
    setSelectedChat(selected?.id ?? "empty");

    if (!selected) {
      setMessagesByChat({});
      setHistoryByChat({});
      return;
    }

    const initialMessages =
      selected === workspace.chats[0]
        ? workspace.initialMessages
        : await chatWaveApi.messages(selected.conversationId!);
    setMessagesByChat({
      [selected.id]: mapApiMessages(initialMessages, selected, user),
    });
    setHistoryByChat({
      [selected.id]: {
        beforeId: initialMessages.at(-1)?.id,
        hasMore: initialMessages.length === PAGE_SIZE,
        loading: false,
      },
    });
  };

  const connectAccount = async (user: ApiUser) => {
    setConnectedUser(user);
    setAuthState("authenticated");
    setWorkspaceLoading(true);
    try {
      await refreshWorkspace(user);
    } catch {
      setChatItems([]);
      setSelectedChat("empty");
      setMessagesByChat({});
      setNotice("Не удалось загрузить чаты. Попробуйте обновить страницу.");
    } finally {
      setWorkspaceLoading(false);
    }
  };
  useEffect(() => {
    connectAccountRef.current = connectAccount;
  });

  useEffect(() => {
    if (!hydrated || sessionRestoreStartedRef.current) return;
    sessionRestoreStartedRef.current = true;
    let active = true;
    void chatWaveApi.restoreSession().then((user) => {
      if (!active) return;
      if (user) {
        void connectAccountRef.current?.(user);
      } else {
        setAuthState("anonymous");
      }
    });
    return () => {
      active = false;
    };
  }, [hydrated]);

  const createConversationFinished = async (conversationId: number) => {
    if (!connectedUser) return;
    setNewConversationOpen(false);
    setWorkspaceLoading(true);
    try {
      await refreshWorkspace(connectedUser, conversationId);
      setNotice("Чат готов.");
    } catch {
      setNotice("Чат создан, но список пока не обновился.");
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const logout = async () => {
    setProfileOpen(false);
    try {
      await chatWaveApi.logout();
    } catch {
      chatWaveApi.clearSession();
    }
    queryClient.clear();
    setConnectedUser(null);
    setApiUsers({});
    setChatItems([]);
    setMessagesByChat({});
    setHistoryByChat({});
    setSelectedChat("empty");
    setAuthState("anonymous");
  };

  const loadOlderMessages = async () => {
    const history = historyByChat[activeChat.id];
    if (
      !activeChat.conversationId ||
      !connectedUser ||
      !history?.hasMore ||
      history.loading
    ) {
      return;
    }
    setHistoryByChat((current) => ({
      ...current,
      [activeChat.id]: { ...history, loading: true },
    }));
    try {
      const older = await chatWaveApi.messages(
        activeChat.conversationId,
        history.beforeId,
      );
      const mapped = mapApiMessages(older, activeChat, connectedUser);
      setMessagesByChat((current) => ({
        ...current,
        [activeChat.id]: mergeMessages(mapped, current[activeChat.id] ?? []),
      }));
      setHistoryByChat((current) => ({
        ...current,
        [activeChat.id]: {
          beforeId: mapped[0]?.id ?? history.beforeId,
          hasMore: older.length === PAGE_SIZE,
          loading: false,
        },
      }));
    } catch {
      setHistoryByChat((current) => ({
        ...current,
        [activeChat.id]: { ...history, loading: false },
      }));
      setNotice("Не удалось загрузить ранние сообщения.");
    }
  };

  const stopTyping = () => {
    if (typingConversationRef.current) {
      sendMessageSignal({
        type: "typing.stop",
        conversation_id: typingConversationRef.current,
      });
      typingConversationRef.current = null;
    }
    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (typingRenewTimerRef.current) {
      window.clearInterval(typingRenewTimerRef.current);
      typingRenewTimerRef.current = null;
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!connectedUser || !activeChat.conversationId) return;
    if (!value.trim()) {
      stopTyping();
      return;
    }
    if (typingConversationRef.current !== activeChat.conversationId) {
      stopTyping();
      typingConversationRef.current = activeChat.conversationId;
      sendMessageSignal({
        type: "typing.start",
        conversation_id: activeChat.conversationId,
      });
      typingRenewTimerRef.current = window.setInterval(() => {
        if (!typingConversationRef.current) return;
        sendMessageSignal({
          type: "typing.start",
          conversation_id: typingConversationRef.current,
        });
      }, 3_000);
    }
    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
    }
    typingStopTimerRef.current = window.setTimeout(stopTyping, 1_500);
  };

  const startEditing = (message: Message) => {
    setEditingMessageId(message.id);
    setDraft(message.text);
  };

  const cancelEditing = () => {
    setEditingMessageId(null);
    setDraft("");
    stopTyping();
  };

  const startReply = (message: Message) => {
    setEditingMessageId(null);
    setReplyingToId(message.id);
    setDraft("");
  };

  const cancelReply = () => {
    setReplyingToId(null);
    setDraft("");
    stopTyping();
  };

  const searchMessages = async (event: FormEvent) => {
    event.preventDefault();
    const searchQuery = messageSearchQuery.trim();
    if (
      searchQuery.length < 3 ||
      !activeChat.conversationId ||
      !connectedUser
    ) {
      return;
    }
    setSearchingMessages(true);
    try {
      const results = await chatWaveApi.searchMessages(
        activeChat.conversationId,
        searchQuery,
      );
      setMessageSearchResults(
        mapApiMessages(results, activeChat, connectedUser),
      );
    } catch {
      setNotice("Не удалось выполнить поиск по сообщениям.");
    } finally {
      setSearchingMessages(false);
    }
  };

  const openSearchResult = (message: Message) => {
    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: mergeMessages(current[activeChat.id] ?? [], [message]),
    }));
    window.requestAnimationFrame(() => {
      document
        .getElementById(`message-${message.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const uploadFile = async (file: File, isVoice = false) => {
    if (!activeChat.conversationId || !connectedUser) {
      setNotice("Создайте или выберите чат.");
      return;
    }
    const optimisticMessage = optimisticMediaMessage(
      optimisticIdRef.current--,
      file,
      draft.trim(),
      replyingToId ?? undefined,
      isVoice,
    );
    setUploadingFile(true);
    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: [...(current[activeChat.id] ?? []), optimisticMessage],
    }));
    setDraft("");
    setReplyingToId(null);
    stopTyping();
    try {
      const saved = await chatWaveApi.sendMedia(
        activeChat.conversationId,
        file,
        optimisticMessage.text,
        isVoice,
        optimisticMessage.clientMessageId!,
        optimisticMessage.replyToId,
      );
      const serverMessage = mapApiMessage(
        saved,
        activeChat,
        connectedUser,
        apiUsersRef.current,
      );
      serverMessage.attachment = {
        name: file.name,
        size: formatFileSize(file.size),
      };
      setMessagesByChat((current) => ({
        ...current,
        [activeChat.id]: mergeMessages(
          (current[activeChat.id] ?? []).filter(
            (message) =>
              message.id !== optimisticMessage.id && message.id !== saved.id,
          ),
          [serverMessage],
        ),
      }));
    } catch {
      setMessagesByChat((current) => ({
        ...current,
        [activeChat.id]: (current[activeChat.id] ?? []).map((message) =>
          message.id === optimisticMessage.id
            ? { ...message, pending: false, failed: true }
            : message,
        ),
      }));
      setNotice("Файл не загружен. Проверьте формат, размер и соединение.");
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const retryMessage = async (message: Message) => {
    const retry = message.retry;
    if (!retry || !activeChat.conversationId || !connectedUser) return;
    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: (current[activeChat.id] ?? []).map((item) =>
        item.id === message.id
          ? { ...item, pending: true, failed: false }
          : item,
      ),
    }));
    try {
      const saved =
        retry.kind === "text"
          ? await chatWaveApi.sendText(
              activeChat.conversationId,
              retry.content,
              retry.clientMessageId,
              retry.replyToId,
            )
          : await chatWaveApi.sendMedia(
              activeChat.conversationId,
              retry.file!,
              retry.content,
              retry.isVoice,
              retry.clientMessageId,
              retry.replyToId,
            );
      const serverMessage = mapApiMessage(
        saved,
        activeChat,
        connectedUser,
        apiUsersRef.current,
      );
      if (retry.file) {
        serverMessage.attachment = {
          name: retry.file.name,
          size: formatFileSize(retry.file.size),
        };
      }
      setMessagesByChat((current) => ({
        ...current,
        [activeChat.id]: mergeMessages(
          (current[activeChat.id] ?? []).filter(
            (item) => item.id !== message.id && item.id !== saved.id,
          ),
          [serverMessage],
        ),
      }));
    } catch {
      setMessagesByChat((current) => ({
        ...current,
        [activeChat.id]: (current[activeChat.id] ?? []).map((item) =>
          item.id === message.id
            ? { ...item, pending: false, failed: true }
            : item,
        ),
      }));
      setNotice("Повторная отправка не удалась.");
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    if (editingMessageId && activeChat.conversationId && connectedUser) {
      try {
        const saved = await chatWaveApi.updateMessage(editingMessageId, content);
        const updated = mapApiMessage(
          saved,
          activeChat,
          connectedUser,
          apiUsersRef.current,
        );
        setMessagesByChat((current) => ({
          ...current,
          [activeChat.id]: mergeMessages(current[activeChat.id] ?? [], [updated]),
        }));
        setEditingMessageId(null);
        setDraft("");
        stopTyping();
      } catch {
        setNotice("Не удалось изменить сообщение.");
      }
      return;
    }
    const replyToId = replyingToId ?? undefined;
    const optimisticMessage = optimisticTextMessage(
      optimisticIdRef.current--,
      content,
      replyToId,
      Boolean(activeChat.conversationId && connectedUser),
    );
    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: [...(current[activeChat.id] ?? []), optimisticMessage],
    }));
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === activeChat.id
          ? { ...chat, preview: content, time: optimisticMessage.time }
          : chat,
      ),
    );
    setDraft("");
    setReplyingToId(null);
    stopTyping();
    if (activeChat.conversationId && connectedUser) {
      try {
        const saved = await chatWaveApi.sendText(
          activeChat.conversationId,
          content,
          optimisticMessage.clientMessageId!,
          replyToId,
        );
        const serverMessage = mapApiMessage(
          saved,
          activeChat,
          connectedUser,
          apiUsersRef.current,
        );
        setMessagesByChat((current) => ({
          ...current,
          [activeChat.id]: mergeMessages(
            (current[activeChat.id] ?? []).filter(
              (message) =>
                message.id !== optimisticMessage.id && message.id !== saved.id,
            ),
            [serverMessage],
          ),
        }));
      } catch {
        setMessagesByChat((current) => ({
          ...current,
          [activeChat.id]: (current[activeChat.id] ?? []).map((message) =>
            message.id === optimisticMessage.id
              ? { ...message, pending: false, failed: true }
              : message,
          ),
        }));
        setNotice("Сообщение не отправлено. Проверьте соединение с сервером.");
      }
    }
  };

  if (!hydrated || authState === "checking") {
    return (
      <AuthScreen
        checking
        onAuthenticated={(user) => void connectAccount(user)}
      />
    );
  }

  if (authState === "anonymous" || !connectedUser) {
    return (
      <AuthScreen onAuthenticated={(user) => void connectAccount(user)} />
    );
  }

  return (
    <main
      className="app-canvas"
      data-theme={theme}
      data-hydrated={hydrated ? "true" : "false"}
    >
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />
      <section className="messenger-shell">
        <aside className="server-rail" aria-label="Навигация">
          <div className="brand-mark" title="ChatWave">
            <Image src="/chatwave-logo.svg" alt="ChatWave" width={42} height={42} />
          </div>
          <div className="rail-divider" />
          <button
            className={`rail-button ${navMode === "messages" ? "active" : ""}`}
            aria-label="Сообщения"
            onClick={() => switchNavigation("messages")}
          >
            <MessageCircleMore size={21} />
            {navMode === "messages" && <span className="rail-indicator" />}
          </button>
          <button
            className={`rail-button ${navMode === "groups" ? "active" : ""}`}
            aria-label="Команды"
            onClick={() => switchNavigation("groups")}
          >
            <Users size={21} />
            {navMode === "groups" && <span className="rail-indicator" />}
          </button>
          <button
            className={`rail-button ${navMode === "mentions" ? "active" : ""}`}
            aria-label="Упоминания"
            onClick={() => switchNavigation("mentions")}
          >
            <AtSign size={21} />
            {unreadChatsCount > 0 && (
              <span className="tiny-badge">{unreadChatsCount}</span>
            )}
            {navMode === "mentions" && <span className="rail-indicator" />}
          </button>
          <button
            className="rail-button"
            aria-label="Добавить пространство"
            onClick={() => setNewConversationOpen(true)}
          >
            <Plus size={21} />
          </button>
          <div className="rail-spacer" />
          <button
            className="rail-button"
            aria-label="Сменить тему"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={20} /> : <MoonStar size={20} />}
          </button>
          <button className="rail-avatar" onClick={() => setProfileOpen(!profileOpen)}>
            {connectedUser.avatar_name ? (
              <img
                src={chatWaveApi.avatarUrl(connectedUser.avatar_name) ?? ""}
                alt=""
              />
            ) : (
              <span>
                {connectedUser?.nickname?.slice(0, 2).toUpperCase() ?? "АК"}
              </span>
            )}
            <i />
          </button>
          {profileOpen && (
            <div className="profile-popover">
              <strong>{connectedUser.nickname}</strong>
              <span>
                {connectedUser?.username
                  ? `@${connectedUser.username}`
                  : "Аккаунт ChatWave"}
              </span>
              <button onClick={() => void logout()}>
                <LogOut size={15} />
                Выйти
              </button>
              <button
                onClick={() => {
                  setProfileOpen(false);
                  setProfileSettingsOpen(true);
                }}
              >
                <Settings size={15} />
                Настройки
              </button>
            </div>
          )}
        </aside>

        <ChatSidebar
          chats={visibleChats}
          selectedChatId={selectedChat}
          mobileOpen={mobileChats}
          navMode={navMode}
          filter={filter}
          query={query}
          unreadCount={unreadChatsCount}
          onSelectChat={(chat) => void selectChat(chat)}
          onNavigationChange={switchNavigation}
          onFilterChange={setFilter}
          onQueryChange={setQuery}
          onNewConversation={() => setNewConversationOpen(true)}
          onOpenProfile={() => {
            setProfileSettingsOpen(true);
            setMobileChats(false);
          }}
        />

        <section className="conversation">
          <header className="conversation-header">
            <button
              className="mobile-menu"
              aria-label="Открыть список чатов"
              onClick={() => setMobileChats(true)}
            >
              <Menu size={21} />
            </button>
            <span className={`avatar avatar-${activeChat.accent} header-avatar`}>
              {activeChat.avatarUrl ? (
                <img src={activeChat.avatarUrl} alt="" />
              ) : (
                activeChat.initials
              )}
              {activeChat.online && <i />}
            </span>
            <div className="conversation-identity">
              <div>
                <strong>{activeChat.title}</strong>
                <span className="verified">
                  <ShieldCheck size={13} />
                </span>
              </div>
              <span>
                {activePresenceText}
              </span>
            </div>
            <div className="header-actions">
              {iconButton(
                "Позвонить",
                <Phone size={18} />,
                "",
                activeChat.conversationId
                  ? () =>
                      call.start(
                        activeChat.conversationId!,
                        "audio",
                        activeChat.type === "group",
                      )
                  : undefined,
                !connectedUser ||
                  !call.ready ||
                  !activeChat.conversationId ||
                  call.phase !== "idle",
              )}
              {iconButton(
                "Видеозвонок",
                <Video size={19} />,
                "",
                activeChat.conversationId
                  ? () =>
                      call.start(
                        activeChat.conversationId!,
                        "video",
                        activeChat.type === "group",
                      )
                  : undefined,
                !connectedUser ||
                  !call.ready ||
                  !activeChat.conversationId ||
                  call.phase !== "idle",
              )}
              {iconButton("Закреплённые сообщения", <Pin size={18} />)}
              {iconButton(
                "Выбрать сообщения",
                <ListChecks size={18} />,
                messageSelectionActive ? "active" : "",
                () => {
                  setMessageSelectionOpen(!messageSelectionActive);
                  setMessageSelectionChatId(
                    messageSelectionActive ? null : selectedChat,
                  );
                  setSelectedMessageIds([]);
                },
                !activeChat.conversationId || !connectedUser,
              )}
              {iconButton(
                "Поиск в чате",
                <Search size={18} />,
                messageSearchOpen ? "active" : "",
                () => {
                  setMessageSearchOpen(!messageSearchOpen);
                  setMessageSearchQuery("");
                  setMessageSearchResults([]);
                },
                !activeChat.conversationId || !connectedUser,
              )}
              <button
                className={`icon-button ${detailsOpen ? "active" : ""}`}
                aria-label="Информация о чате"
                onClick={() => setDetailsOpen(!detailsOpen)}
              >
                <Info size={19} />
              </button>
            </div>
          </header>

          {messageSelectionActive && (
            <div className="message-selection-bar">
              <div>
                <ListChecks size={17} />
                <span>
                  Выбрано: <strong>{selectedMessageIds.length}</strong>
                </span>
                <small>Можно удалить свои и чужие сообщения</small>
              </div>
              <button
                className="delete-selected"
                disabled={selectedMessageIds.length === 0}
                onClick={async () => {
                  if (await messageMutations.removeMany(selectedMessageIds)) {
                    setSelectedMessageIds([]);
                    setMessageSelectionOpen(false);
                    setMessageSelectionChatId(null);
                  }
                }}
              >
                <Trash2 size={15} />
                Удалить
              </button>
              <button
                onClick={() => {
                  setSelectedMessageIds([]);
                  setMessageSelectionOpen(false);
                  setMessageSelectionChatId(null);
                }}
              >
                Отмена
              </button>
            </div>
          )}

          {messageSearchOpen && (
            <MessageSearch
              query={messageSearchQuery}
              results={messageSearchResults}
              searching={searchingMessages}
              onQueryChange={setMessageSearchQuery}
              onSubmit={searchMessages}
              onClose={() => setMessageSearchOpen(false)}
              onOpenResult={openSearchResult}
            />
          )}

          <div className="conversation-content">
            <div className="messages-pane">
              <MessageFeed
                chat={activeChat}
                messages={activeMessages}
                history={historyByChat[activeChat.id]}
                typingUsers={activeTypingUsers}
                connected={Boolean(connectedUser)}
                selectionMode={messageSelectionActive}
                selectedMessageIds={selectedMessageIds}
                reactionPickerFor={reactionPickerFor}
                onLoadOlder={() => void loadOlderMessages()}
                onOpenMessage={openSearchResult}
                onDownload={(message) => void messageMutations.download(message)}
                onReact={(message, emoji) =>
                  void messageMutations.react(message, emoji)
                }
                onToggleReactionPicker={(messageId) =>
                  setReactionPickerFor(
                    reactionPickerFor === messageId ? null : messageId,
                  )
                }
                onReply={startReply}
                onEdit={startEditing}
                onDelete={(message) => void messageMutations.remove(message)}
                onRetry={(message) => void retryMessage(message)}
                onPin={(message) => {
                  void chatWaveApi
                    .pinMessage(message.id)
                    .then(() => {
                      setDetailsRevision((current) => current + 1);
                      setNotice("Сообщение закреплено.");
                    })
                    .catch(() => setNotice("Не удалось закрепить сообщение."));
                }}
                onToggleSelection={(messageId) =>
                  setSelectedMessageIds((current) =>
                    current.includes(messageId)
                      ? current.filter((id) => id !== messageId)
                      : [...current, messageId],
                  )
                }
              />

              <MessageComposer
                chat={activeChat}
                draft={draft}
                editingMessage={editingMessage}
                replyingMessage={replyingMessage}
                uploadingFile={uploadingFile}
                recordingVoice={voiceRecorder.recording}
                recordingSeconds={voiceRecorder.seconds}
                fileInputRef={fileInputRef}
                onDraftChange={handleDraftChange}
                onSubmit={sendMessage}
                onFileSelected={(file) => void uploadFile(file)}
                onCancelEditing={cancelEditing}
                onCancelReply={cancelReply}
                onStartRecording={() => {
                  if (!activeChat.conversationId || !connectedUser) {
                    setNotice(
                      "Создайте или выберите чат для голосового сообщения.",
                    );
                    return;
                  }
                  void voiceRecorder.start();
                }}
                onStopRecording={voiceRecorder.stop}
              />
            </div>

            <ChatDetails
              chat={activeChat}
              members={activeMembers}
              currentUser={connectedUser}
              users={apiUsers}
              open={detailsOpen}
              revision={detailsRevision}
              onClose={() => setDetailsOpen(false)}
              onOpenMessage={openSearchResult}
              onDownload={(message) => void messageMutations.download(message)}
              onAddMember={
                activeChat.type === "group" &&
                ["creator", "admin"].includes(activeChat.currentUserRole ?? "")
                  ? () => setAddMembersOpen(true)
                  : undefined
              }
            />
          </div>
        </section>
      </section>

      {newConversationOpen && (
        <NewConversationModal
          currentUserId={connectedUser.id}
          onClose={() => setNewConversationOpen(false)}
          onCreated={(conversationId) =>
            void createConversationFinished(conversationId)
          }
        />
      )}
      {profileSettingsOpen && (
        <ProfileSettingsModal
          user={connectedUser}
          onClose={() => setProfileSettingsOpen(false)}
          onUpdated={(updatedUser) => {
            const selectedConversationId = activeChat.conversationId;
            setConnectedUser(updatedUser);
            setApiUsers((current) => ({
              ...current,
              [updatedUser.id]: updatedUser,
            }));
            apiUsersRef.current = {
              ...apiUsersRef.current,
              [updatedUser.id]: updatedUser,
            };
            void refreshWorkspace(updatedUser, selectedConversationId);
          }}
          onPasswordChanged={() => {
            setProfileSettingsOpen(false);
            void logout();
          }}
        />
      )}
      {addMembersOpen &&
        connectedUser &&
        activeChat.type === "group" &&
        activeChat.conversationId && (
          <AddGroupMembersModal
            groupId={activeChat.conversationId}
            currentUserId={connectedUser.id}
            existingMemberIds={activeChat.memberIds ?? []}
            onClose={() => setAddMembersOpen(false)}
            onAdded={() => {
              const conversationId = activeChat.conversationId!;
              setAddMembersOpen(false);
              setWorkspaceLoading(true);
              void refreshWorkspace(connectedUser, conversationId)
                .then(() => setNotice("Участники добавлены."))
                .catch(() =>
                  setNotice(
                    "Участники добавлены, но список пока не обновился.",
                  ),
                )
                .finally(() => setWorkspaceLoading(false));
            }}
          />
        )}
      {workspaceLoading && (
        <div className="workspace-loading" role="status">
          <span className="button-spinner" />
          Синхронизируем чаты…
        </div>
      )}
      {call.phase !== "idle" && (
        <CallOverlay
          phase={call.phase}
          media={call.media}
          title={callChat?.title ?? "Звонок ChatWave"}
          initials={callChat?.initials ?? "CW"}
          localStream={call.localStream}
          remoteStream={call.remoteStream}
          groupCall={call.groupCall}
          remoteStreams={call.remoteStreams}
          remoteMediaStates={call.remoteMediaStates}
          muted={call.muted}
          cameraOff={call.cameraOff}
          screenSharing={call.screenSharing}
          screenAudioSharing={call.screenAudioSharing}
          remoteScreenSharing={call.remoteScreenSharing}
          remoteScreenAudioSharing={call.remoteScreenAudioSharing}
          remoteMuted={call.remoteMuted}
          screenShareError={call.screenShareError}
          error={call.error}
          onAccept={call.accept}
          onEnd={call.end}
          onClose={call.reset}
          onToggleMute={call.toggleMute}
          onToggleCamera={call.toggleCamera}
          onToggleScreenShare={call.toggleScreenShare}
        />
      )}
      {mobileChats && (
        <button
          className="mobile-backdrop"
          aria-label="Закрыть список чатов"
          onClick={() => setMobileChats(false)}
        />
      )}
      {notice && (
        <button
          className="app-notice"
          onClick={() => setNotice("")}
          aria-label="Закрыть уведомление"
        >
          <ShieldCheck size={17} />
          {notice}
          <X size={15} />
        </button>
      )}
    </main>
  );
}

function GroupStreamTile({
  userId,
  stream,
  video,
  volume,
  screenSharing,
  screenAudio,
  microphoneMuted,
}: {
  userId: number;
  stream: MediaStream;
  video: boolean;
  volume: number;
  screenSharing: boolean;
  screenAudio: boolean;
  microphoneMuted: boolean;
}) {
  const mediaElement = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const tile = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mediaElement.current) return;
    mediaElement.current.srcObject = stream;
    mediaElement.current.volume = volume;
  }, [stream, volume, video]);

  if (!video) {
    return (
      <audio
        ref={mediaElement as RefObject<HTMLAudioElement>}
        autoPlay
        aria-label={`Звук участника ${userId}`}
      />
    );
  }
  return (
    <div
      ref={tile}
      className={`group-video-tile ${screenSharing ? "screen-share-tile" : ""}`}
    >
      <video
        ref={mediaElement as RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        onDoubleClick={() => {
          if (screenSharing) void tile.current?.requestFullscreen();
        }}
      />
      <span>
        {microphoneMuted && <MicOff size={13} aria-label="Микрофон выключен" />}
        Участник #{userId}
        {screenAudio ? " · экран со звуком" : screenSharing ? " · экран" : ""}
      </span>
      {screenSharing && (
        <button
          className="screen-fullscreen-button"
          onClick={() => void tile.current?.requestFullscreen()}
          aria-label="Развернуть демонстрацию на весь экран"
          title="На весь экран"
        >
          <Maximize2 size={19} />
        </button>
      )}
    </div>
  );
}

function CallOverlay({
  phase,
  media,
  title,
  initials,
  localStream,
  remoteStream,
  groupCall,
  remoteStreams,
  remoteMediaStates,
  muted,
  cameraOff,
  screenSharing,
  screenAudioSharing,
  remoteScreenSharing,
  remoteScreenAudioSharing,
  remoteMuted,
  screenShareError,
  error,
  onAccept,
  onEnd,
  onClose,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
}: {
  phase: CallPhase;
  media: CallMedia;
  title: string;
  initials: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  groupCall: boolean;
  remoteStreams: Record<number, MediaStream>;
  remoteMediaStates: Record<
    number,
    { screenSharing: boolean; screenAudio: boolean; microphoneMuted: boolean }
  >;
  muted: boolean;
  cameraOff: boolean;
  screenSharing: boolean;
  screenAudioSharing: boolean;
  remoteScreenSharing: boolean;
  remoteScreenAudioSharing: boolean;
  remoteMuted: boolean;
  screenShareError: string;
  error: string;
  onAccept: () => void;
  onEnd: () => void;
  onClose: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
}) {
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteStage = useRef<HTMLDivElement>(null);
  const callWindow = useRef<HTMLElement>(null);
  const [screenFullscreen, setScreenFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<
    "window" | "minimized" | "fullscreen"
  >("window");
  const [remoteVolume, setRemoteVolume] = useState(1);
  const remoteHasVideo = Boolean(
    remoteStream
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && !track.muted),
  );
  const localHasVideo = Boolean(
    localStream
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && track.enabled),
  );
  const groupVideoStreams = Object.entries(remoteStreams).filter(
    ([, stream]) =>
      stream
        .getVideoTracks()
        .some((track) => track.readyState === "live" && !track.muted),
  );
  const groupAudioStreams = Object.entries(remoteStreams).filter(
    ([, stream]) =>
      !stream
        .getVideoTracks()
        .some((track) => track.readyState === "live" && !track.muted),
  );

  useEffect(() => {
    if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
    if (remoteAudio.current) remoteAudio.current.srcObject = remoteStream;
  }, [remoteStream]);
  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = localStream;
  }, [localStream, viewMode]);
  useEffect(() => {
    if (remoteVideo.current) remoteVideo.current.volume = remoteVolume;
    if (remoteAudio.current) remoteAudio.current.volume = remoteVolume;
  }, [remoteStream, remoteVolume, viewMode]);
  useEffect(() => {
    const updateFullscreenState = () => {
      setScreenFullscreen(document.fullscreenElement === remoteStage.current);
      if (document.fullscreenElement === callWindow.current) {
        setViewMode("fullscreen");
      } else {
        setViewMode((current) =>
          current === "fullscreen" &&
          document.fullscreenElement !== remoteStage.current
            ? "window"
            : current,
        );
      }
    };
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () =>
      document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, []);
  useEffect(() => {
    if (
      !remoteScreenSharing &&
      document.fullscreenElement === remoteStage.current
    ) {
      void document.exitFullscreen();
    }
  }, [remoteScreenSharing]);

  const toggleScreenFullscreen = async () => {
    try {
      if (document.fullscreenElement === remoteStage.current) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await remoteStage.current?.requestFullscreen();
      }
    } catch {
      // The browser can reject fullscreen when its permissions change.
    }
  };

  const minimizeCall = async () => {
    if (document.fullscreenElement === callWindow.current) {
      await document.exitFullscreen().catch(() => undefined);
    }
    setViewMode("minimized");
  };

  const toggleCallFullscreen = async () => {
    try {
      if (viewMode === "fullscreen") {
        if (document.fullscreenElement === callWindow.current) {
          await document.exitFullscreen();
        }
        setViewMode("window");
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        setViewMode("fullscreen");
        await callWindow.current?.requestFullscreen();
      }
    } catch {
      // CSS fullscreen remains available when the native API is denied.
      setViewMode((current) =>
        current === "fullscreen" ? "window" : "fullscreen",
      );
    }
  };

  const status = {
    incoming: groupCall
      ? media === "video"
        ? "Входящий групповой видеозвонок"
        : "Входящий групповой звонок"
      : media === "video"
        ? "Входящий видеозвонок"
        : "Входящий звонок",
    outgoing: groupCall ? "Открываем комнату…" : "Вызываем…",
    connecting: "Соединяем…",
    active: "Защищённое соединение",
    error: "Звонок завершён",
    idle: "",
  }[phase];

  if (viewMode === "minimized") {
    return (
      <div className="call-backdrop call-overlay-minimized" role="presentation">
        <section className="call-mini-window" aria-label={`Звонок с ${title}`}>
          <button
            className="call-mini-main"
            onClick={() => setViewMode("window")}
            aria-label="Раскрыть звонок"
          >
            <span className="call-mini-avatar">{initials}</span>
            <span>
              <strong>{title}</strong>
              <small>{status}</small>
            </span>
          </button>
          <button
            className="call-mini-action"
            onClick={() => setViewMode("fullscreen")}
            aria-label="Развернуть звонок на весь экран"
            title="На весь экран"
          >
            <Maximize2 size={17} />
          </button>
          <button
            className="call-mini-action end"
            onClick={onEnd}
            aria-label="Завершить звонок"
            title="Завершить"
          >
            <PhoneOff size={17} />
          </button>
        </section>
      </div>
    );
  }

  return (
    <div
      className={`call-backdrop ${
        viewMode === "fullscreen" ? "call-overlay-fullscreen" : ""
      }`}
      role="presentation"
    >
      <section
        ref={callWindow}
        className={`call-window ${media === "video" ? "video-call" : "audio-call"} ${
          viewMode === "fullscreen" ? "call-window-fullscreen" : ""
        }`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="call-title"
        onWheel={(event) => {
          if (viewMode !== "window") return;
          document
            .querySelector<HTMLElement>(".messages-scroll")
            ?.scrollBy({ top: event.deltaY });
        }}
      >
        <div className="call-aurora" />
        <div className="call-window-actions">
          <button
            onClick={() => void minimizeCall()}
            aria-label="Свернуть звонок"
            title="Свернуть"
          >
            <Minus size={19} />
          </button>
          <button
            onClick={() => void toggleCallFullscreen()}
            aria-label={
              viewMode === "fullscreen"
                ? "Выйти из полноэкранного режима"
                : "Развернуть звонок на весь экран"
            }
            title={viewMode === "fullscreen" ? "Свернуть окно" : "На весь экран"}
          >
            {viewMode === "fullscreen" ? (
              <Minimize2 size={18} />
            ) : (
              <Maximize2 size={18} />
            )}
          </button>
        </div>
        {!groupCall && !remoteHasVideo && (
          <audio ref={remoteAudio} autoPlay aria-label="Звук собеседника" />
        )}
        {groupCall && groupAudioStreams.length > 0 && (
          <>
            {groupAudioStreams.map(([userId, stream]) => (
              <GroupStreamTile
                key={userId}
                userId={Number(userId)}
                stream={stream}
                video={false}
                volume={remoteVolume}
                screenSharing={
                  remoteMediaStates[Number(userId)]?.screenSharing ?? false
                }
                screenAudio={
                  remoteMediaStates[Number(userId)]?.screenAudio ?? false
                }
                microphoneMuted={
                  remoteMediaStates[Number(userId)]?.microphoneMuted ?? false
                }
              />
            ))}
          </>
        )}
        {groupCall && groupVideoStreams.length > 0 ? (
          <div
            className={`group-video-grid group-video-grid-${Math.min(
              groupVideoStreams.length,
              4,
            )}`}
          >
            {groupVideoStreams.map(([userId, stream]) => (
              <GroupStreamTile
                key={`grid-${userId}`}
                userId={Number(userId)}
                stream={stream}
                video
                volume={remoteVolume}
                screenSharing={
                  remoteMediaStates[Number(userId)]?.screenSharing ?? false
                }
                screenAudio={
                  remoteMediaStates[Number(userId)]?.screenAudio ?? false
                }
                microphoneMuted={
                  remoteMediaStates[Number(userId)]?.microphoneMuted ?? false
                }
              />
            ))}
          </div>
        ) : remoteHasVideo && !groupCall && remoteStream ? (
          <div
            ref={remoteStage}
            className={`remote-stage ${remoteScreenSharing ? "screen-share-stage" : ""}`}
          >
            <video
              ref={remoteVideo}
              className={`remote-video ${remoteScreenSharing ? "screen-share-video" : ""}`}
              autoPlay
              playsInline
              onDoubleClick={
                remoteScreenSharing ? toggleScreenFullscreen : undefined
              }
            />
            {remoteScreenSharing && (
              <button
                className="screen-fullscreen-button"
                onClick={toggleScreenFullscreen}
                aria-label={
                  screenFullscreen
                    ? "Выйти из полноэкранного режима"
                    : "Развернуть демонстрацию на весь экран"
                }
                title={
                  screenFullscreen
                    ? "Выйти из полноэкранного режима"
                    : "На весь экран"
                }
              >
                {screenFullscreen ? (
                  <Minimize2 size={20} />
                ) : (
                  <Maximize2 size={20} />
                )}
              </button>
            )}
          </div>
        ) : !remoteHasVideo && groupVideoStreams.length === 0 ? (
          <div className="call-avatar-wrap">
            <span className="call-avatar">{initials}</span>
            <i />
            <i />
          </div>
        ) : null}

        {groupCall && groupAudioStreams.some(
          ([userId]) =>
            remoteMediaStates[Number(userId)]?.microphoneMuted,
        ) && (
          <div className="group-muted-list" aria-live="polite">
            {groupAudioStreams
              .filter(
                ([userId]) =>
                  remoteMediaStates[Number(userId)]?.microphoneMuted,
              )
              .map(([userId]) => (
                <span key={`muted-${userId}`}>
                  <MicOff size={14} />
                  Участник #{userId} выключил микрофон
                </span>
              ))}
          </div>
        )}

        <div className="call-copy">
          <span>{status}</span>
          <h2 id="call-title">{title}</h2>
          {phase === "active" && (
            <small>
              WebRTC · сквозное медиасоединение
              {groupCall
                ? ` · ${Object.keys(remoteStreams).length + 1} участников`
                : ""}
            </small>
          )}
          {!groupCall && remoteMuted && (
            <small className="remote-muted-status" aria-live="polite">
              <MicOff size={14} />
              Собеседник выключил микрофон
            </small>
          )}
          {remoteScreenSharing && (
            <small className="screen-share-status">
              Собеседник демонстрирует экран · до 1440p / 60 FPS
              {remoteScreenAudioSharing ? " · со звуком" : ""}
            </small>
          )}
          {screenSharing && (
            <small className="screen-share-status">
              Демонстрация экрана · до 1440p / 60 FPS
              {screenAudioSharing
                ? " · звук передаётся"
                : " · включите звук в окне выбора"}
            </small>
          )}
          {screenShareError && (
            <small className="call-error">{screenShareError}</small>
          )}
          {phase === "error" && <small className="call-error">{error}</small>}
        </div>

        {localHasVideo && localStream && (
          <video
            ref={localVideo}
            className={`local-video ${screenSharing ? "screen-share-preview" : ""}`}
            autoPlay
            muted
            playsInline
          />
        )}

        <div className="call-controls">
          {phase === "incoming" ? (
            <>
              <button className="call-button decline" onClick={onEnd}>
                <PhoneOff size={21} />
                <span>Отклонить</span>
              </button>
              <button className="call-button accept" onClick={onAccept}>
                {media === "video" ? <Video size={22} /> : <Phone size={22} />}
                <span>Принять</span>
              </button>
            </>
          ) : phase === "error" ? (
            <button className="call-button neutral" onClick={onClose}>
              <X size={21} />
              <span>Закрыть</span>
            </button>
          ) : (
            <>
              <button
                className={`call-button neutral ${muted ? "disabled" : ""}`}
                onClick={onToggleMute}
                aria-label={muted ? "Включить микрофон" : "Выключить микрофон"}
              >
                {muted ? <MicOff size={21} /> : <Mic size={21} />}
                <span>{muted ? "Включить" : "Микрофон"}</span>
              </button>
              <button
                className={`call-button neutral ${cameraOff ? "disabled" : ""}`}
                onClick={onToggleCamera}
                disabled={screenSharing}
                aria-label={cameraOff ? "Включить камеру" : "Выключить камеру"}
              >
                {cameraOff ? <VideoOff size={21} /> : <Video size={21} />}
                <span>{cameraOff ? "Включить" : "Камера"}</span>
              </button>
              <button
                className={`call-button neutral ${screenSharing ? "sharing" : ""}`}
                onClick={onToggleScreenShare}
                disabled={phase !== "connecting" && phase !== "active"}
                aria-label={
                  screenSharing
                    ? "Остановить демонстрацию экрана"
                    : "Начать демонстрацию экрана"
                }
              >
                {screenSharing ? (
                  <ScreenShareOff size={21} />
                ) : (
                  <ScreenShare size={21} />
                )}
                <span>{screenSharing ? "Остановить" : "Экран"}</span>
              </button>
              <label className="call-volume" title="Громкость собеседника">
                <Volume2 size={19} />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={remoteVolume}
                  onChange={(event) =>
                    setRemoteVolume(Number(event.currentTarget.value))
                  }
                  aria-label="Громкость собеседника"
                />
                <span>{Math.round(remoteVolume * 100)}%</span>
              </label>
              <button className="call-button decline" onClick={onEnd}>
                <PhoneOff size={21} />
                <span>Завершить</span>
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
