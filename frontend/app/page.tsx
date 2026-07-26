"use client";

import {
  ArrowLeft,
  AtSign,
  Bookmark,
  Info,
  ListChecks,
  Maximize2,
  MessageCircleMore,
  Mic,
  MicOff,
  Minus,
  Minimize2,
  MoonStar,
  Phone,
  PhoneOff,
  Plus,
  Search,
  ScreenShare,
  ScreenShareOff,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiMessage, ApiUser, chatWaveApi } from "./api";
import {
  CallMedia,
  CallPhase,
  DesktopScreenSource,
  SCREEN_SHARE_PRESETS,
  ScreenShareQuality,
  useCall,
} from "./calls";
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
import { UserProfileModal } from "./components/user-profile-modal";
import { ProfileSettingsModal } from "./components/profile-settings-modal";
import {
  applyWorkspaceMetadata,
  loadAccountWorkspace,
} from "./account-workspace";
import { useMessageMutations } from "./hooks/use-message-mutations";
import {
  optimisticMediaMessage,
  optimisticTextMessage,
  reconcileOptimisticMessage,
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
import {
  decryptApiMessage,
  decryptApiMessages,
  encryptTextMessage,
  initializeCrypto,
  stopCryptoPolling,
} from "./e2ee/client";
import { closeCryptoMachine } from "./e2ee/crypto-runtime";
import {
  CHAT_BACKGROUND_EVENT,
  loadChatBackground,
} from "./chat-background";

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

const isSameOptimisticMessage = (left: Message, right: Message) =>
  left.id === right.id ||
  Boolean(
    left.clientMessageId &&
      right.clientMessageId &&
      left.clientMessageId === right.clientMessageId,
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
    setQuery,
    setFilter,
    setNavigation,
    setDetailsOpen,
    setMobileChatsOpen: setMobileChats,
    setTheme,
  } = useUiState();
  const [connectedUser, setConnectedUser] = useState<ApiUser | null>(null);
  const [chatBackground, setChatBackground] = useState<{
    url: string;
    mediaType: string;
  } | null>(null);
  const [authState, setAuthState] = useState<
    "checking" | "anonymous" | "authenticated"
  >("checking");
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [viewingProfileId, setViewingProfileId] = useState<number | null>(null);
  const [pinnedConversationIds, setPinnedConversationIds] = useState<number[]>(
    [],
  );
  const [sidebarWidth, setSidebarWidth] = useState(364);
  const sidebarResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
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
  const mobileNavigationInitializedRef = useRef(false);
  const connectAccountRef = useRef<
    ((user: ApiUser) => Promise<void>) | null
  >(null);

  useEffect(() => {
    if (!connectedUser) {
      const resetTimer = window.setTimeout(() => setChatBackground(null), 0);
      return () => window.clearTimeout(resetTimer);
    }
    let disposed = false;
    let activeUrl: string | null = null;
    const refresh = async () => {
      try {
        const background = await loadChatBackground(connectedUser.id);
        if (disposed) return;
        if (activeUrl) URL.revokeObjectURL(activeUrl);
        activeUrl = background ? URL.createObjectURL(background.blob) : null;
        setChatBackground(
          activeUrl && background
            ? { url: activeUrl, mediaType: background.mediaType }
            : null,
        );
      } catch {
        if (!disposed) setChatBackground(null);
      }
    };
    const onChange = (event: Event) => {
      const userId = (event as CustomEvent<{ userId?: number }>).detail?.userId;
      if (userId === connectedUser.id) void refresh();
    };
    void refresh();
    window.addEventListener(CHAT_BACKGROUND_EVENT, onChange);
    return () => {
      disposed = true;
      window.removeEventListener(CHAT_BACKGROUND_EVENT, onChange);
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [connectedUser]);

  useEffect(() => {
    if (!connectedUser) return;
    const media = window.matchMedia("(max-width: 720px)");
    const handleBreakpoint = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileChats(true);
    };
    media.addEventListener("change", handleBreakpoint);
    let timer: number | undefined;
    if (!mobileNavigationInitializedRef.current) {
      mobileNavigationInitializedRef.current = true;
      if (media.matches) {
        timer = window.setTimeout(() => setMobileChats(true), 0);
      }
    }
    return () => {
      if (timer) window.clearTimeout(timer);
      media.removeEventListener("change", handleBreakpoint);
    };
  }, [connectedUser, setMobileChats]);

  useEffect(() => {
    const returnToChatList = () => {
      if (!window.matchMedia("(max-width: 720px)").matches) return;
      setDetailsOpen(false);
      setMessageSearchOpen(false);
      setMobileChats(true);
    };
    window.addEventListener("popstate", returnToChatList);
    return () => window.removeEventListener("popstate", returnToChatList);
  }, [setDetailsOpen, setMobileChats]);
  const syncMissingConversation = useCallback(
    async (conversationId: number) => {
      if (!connectedUser) return null;
      try {
        await queryClient.invalidateQueries({
          queryKey: ["conversations", connectedUser.id],
        });
        const workspace = await loadAccountWorkspace(
          connectedUser,
          queryClient,
        );
        const chat =
          workspace.chats.find(
            (item) => item.conversationId === conversationId,
          ) ?? null;
        if (!chat) return null;
        setApiUsers(workspace.users);
        apiUsersRef.current = workspace.users;
        setChatItems(workspace.chats);
        return { chat, users: workspace.users };
      } catch {
        return null;
      }
    },
    [connectedUser, queryClient],
  );
  const call = useCall(Boolean(connectedUser) && realtimeReady);
  const presenceByUser = usePresence(realtimeReady ? connectedUser : null);
  const sendMessageSignal = useMessageSocket({
    connectedUser: realtimeReady ? connectedUser : null,
    selectedChatId: selectedChat,
    chats: chatItems,
    users: apiUsers,
    setChats: setChatItems,
    setMessages: setMessagesByChat,
    setTyping: setTypingByConversation,
    onMissingConversation: syncMissingConversation,
  });

  useEffect(() => initializeNotificationSounds(), []);

  useEffect(() => {
    if (!connectedUser) {
      const resetTimer = window.setTimeout(
        () => setPinnedConversationIds([]),
        0,
      );
      return () => window.clearTimeout(resetTimer);
    }
    const restoreTimer = window.setTimeout(() => {
      try {
        const stored = JSON.parse(
          localStorage.getItem(`chatwave_pinned_${connectedUser.id}`) ?? "[]",
        );
        setPinnedConversationIds(
          Array.isArray(stored)
            ? stored.filter((value): value is number => Number.isInteger(value))
            : [],
        );
        const storedWidth = Number(
          localStorage.getItem("chatwave_sidebar_width"),
        );
        if (Number.isFinite(storedWidth)) {
          setSidebarWidth(Math.min(460, Math.max(76, storedWidth)));
        }
      } catch {
        setPinnedConversationIds([]);
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [connectedUser]);

  const togglePinnedChat = (chat: Chat) => {
    if (!chat.conversationId || !connectedUser) return;
    setPinnedConversationIds((current) => {
      const next = current.includes(chat.conversationId!)
        ? current.filter((id) => id !== chat.conversationId)
        : [...current, chat.conversationId!];
      localStorage.setItem(
        `chatwave_pinned_${connectedUser.id}`,
        JSON.stringify(next),
      );
      return next;
    });
  };

  const resizeSidebarStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    sidebarResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeSidebarMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = sidebarResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const nextWidth = Math.min(
      460,
      Math.max(76, resize.startWidth + event.clientX - resize.startX),
    );
    setSidebarWidth(nextWidth);
    localStorage.setItem("chatwave_sidebar_width", String(nextWidth));
  };

  const resizeSidebarEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sidebarResizeRef.current?.pointerId !== event.pointerId) return;
    sidebarResizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

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
          pinned: Boolean(
            chat.conversationId &&
              pinnedConversationIds.includes(chat.conversationId),
          ),
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
    [chatItems, connectedUser?.id, pinnedConversationIds, presenceByUser],
  );

  const visibleChats = useMemo(
    () =>
      displayChatItems
        .filter(
          (chat) =>
            (filter === "all" || chat.unread) &&
            ((navMode === "messages" && chat.type !== "group") ||
              (navMode === "groups" && chat.type === "group") ||
              (navMode === "mentions" && chat.unread)) &&
            `${chat.title} ${chat.preview}`
              .toLocaleLowerCase("ru")
              .includes(query.toLocaleLowerCase("ru")),
        )
        .sort(
          (left, right) =>
            Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
            (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0),
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
        username: user.username,
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

  useEffect(() => {
    if (
      connectedUser &&
      call.conversationId &&
      !callChat
    ) {
      const timer = window.setTimeout(
        () => void syncMissingConversation(call.conversationId!),
        0,
      );
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [
    call.conversationId,
    callChat,
    connectedUser,
    syncMissingConversation,
  ]);
  const activeTypingUsers = activeChat.conversationId
    ? (typingByConversation[activeChat.conversationId] ?? [])
        .map((userId) => apiUsers[userId]?.nickname)
        .filter(Boolean)
    : [];
  const activeRecipientPresence = activeChat.recipientId
    ? presenceByUser[activeChat.recipientId]
    : undefined;
  const activePresenceText =
    activeChat.type === "saved"
      ? "Ваши сохранённые сообщения"
      : activeChat.type === "direct"
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
        return;
      }
      if (
        event.key === "Escape" &&
        activeChat.conversationId &&
        !document.querySelector(
          ".modal-backdrop, .profile-settings-backdrop, .media-lightbox, .call-backdrop",
        )
      ) {
        event.preventDefault();
        sendMessageSignal({
          type: "typing.stop",
          conversation_id: activeChat.conversationId,
        });
        setSelectedChat("empty");
        setDraft("");
        setEditingMessageId(null);
        setReplyingToId(null);
        setReactionPickerFor(null);
        setDetailsOpen(false);
        setMobileChats(false);
      }
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [
    activeChat.conversationId,
    connectedUser,
    messageSearchOpen,
    sendMessageSignal,
    setDetailsOpen,
    setMobileChats,
  ]);
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

  const mapApiMessages = async (
    apiMessages: ApiMessage[],
    chat: Chat,
    currentUser: ApiUser,
  ): Promise<Message[]> => {
    const decryptedMessages = await decryptApiMessages(
      currentUser.id,
      apiMessages,
    );
    return decryptedMessages
      .slice()
      .reverse()
      .map((message) =>
        mapApiMessage(message, chat, currentUser, apiUsersRef.current),
      );
  };

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
    setDetailsOpen(false);
    if (
      window.matchMedia("(max-width: 720px)").matches &&
      selectedChat !== chat.id
    ) {
      window.history.pushState({ chatwaveMobileChat: true }, "");
    }
    setMobileChats(false);
    setChatItems((current) =>
      current.map((item) =>
        item.id === chat.id ? { ...item, unread: undefined } : item,
      ),
    );
    if (!chat.conversationId || !connectedUser) return;
    try {
      const apiMessages = await chatWaveApi.messages(chat.conversationId);
      const incomingMessageIds = apiMessages
        .filter((message) => message.sender_id !== connectedUser.id)
        .map((message) => message.id);
      if (incomingMessageIds.length) {
        sendMessageSignal({
          type: "message.read_batch",
          conversation_id: chat.conversationId,
          message_ids: incomingMessageIds,
        });
      }
      const mappedMessages = await mapApiMessages(
        apiMessages,
        chat,
        connectedUser,
      );
      setMessagesByChat((current) => ({
        ...current,
        [chat.id]: mergeMessages(
          mappedMessages,
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
        (mode === "messages" && chat.type !== "group") ||
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
      setRealtimeReady(true);
      return;
    }

    const initialMessages = await (
      selected === workspace.chats[0]
        ? workspace.loadInitialMessages()
        : chatWaveApi.messages(selected.conversationId!)
    ).catch(() => {
      setNotice(
        "Чаты загружены. Сообщения выбранного чата появятся после восстановления соединения.",
      );
      return [];
    });
    const mappedInitialMessages = await mapApiMessages(
      initialMessages,
      selected,
      user,
    );
    setMessagesByChat((current) => ({
      ...current,
      [selected.id]: mergeMessages(
        current[selected.id] ?? [],
        mappedInitialMessages,
      ),
    }));
    setHistoryByChat((current) => ({
      ...current,
      [selected.id]: {
        beforeId: initialMessages.at(-1)?.id,
        hasMore: initialMessages.length === PAGE_SIZE,
        loading: false,
      },
    }));
    setRealtimeReady(true);

    void workspace
      .loadMetadata()
      .then((metadata) => {
        setChatItems((current) =>
          applyWorkspaceMetadata(current, metadata, user.id),
        );
      })
      .catch(() => undefined);

    void initializeCrypto(
      user.id,
      workspace.chats.flatMap((chat) => chat.memberIds ?? []),
    ).catch((error) => {
      console.error("ChatWave E2EE initialization failed", error);
      setNotice(
        "Чаты загружены, но защищённая синхронизация временно недоступна.",
      );
    });
  };

  const connectAccount = async (user: ApiUser) => {
    setRealtimeReady(false);
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
    try {
      await chatWaveApi.logout();
    } catch {
      chatWaveApi.clearSession();
    }
    queryClient.clear();
    stopCryptoPolling();
    closeCryptoMachine();
    setConnectedUser(null);
    setRealtimeReady(false);
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
      const mapped = await mapApiMessages(older, activeChat, connectedUser);
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
    if (message.encrypted) {
      setNotice("Редактирование E2EE-сообщений появится после ротации ключей.");
      return;
    }
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
      const legacyResults = await mapApiMessages(
        results,
        activeChat,
        connectedUser,
      );
      const normalizedQuery = searchQuery.toLocaleLowerCase("ru");
      const encryptedLocalResults = activeMessages.filter(
        (message) =>
          message.encrypted &&
          message.text.toLocaleLowerCase("ru").includes(normalizedQuery),
      );
      setMessageSearchResults(
        mergeMessages(legacyResults, encryptedLocalResults),
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
      const decryptedSaved = await decryptApiMessage(connectedUser.id, saved);
      const serverMessage = mapApiMessage(
        decryptedSaved,
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
        [activeChat.id]: reconcileOptimisticMessage(
          current[activeChat.id] ?? [],
          optimisticMessage.id,
          serverMessage,
        ),
      }));
    } catch {
      setMessagesByChat((current) => ({
        ...current,
        [activeChat.id]: (current[activeChat.id] ?? []).map((message) =>
          isSameOptimisticMessage(message, optimisticMessage)
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
        isSameOptimisticMessage(item, message)
          ? { ...item, pending: true, failed: false }
          : item,
      ),
    }));
    try {
      const saved =
        retry.kind === "text"
          ? await chatWaveApi.sendEncrypted(
              activeChat.conversationId,
              await encryptTextMessage(
                connectedUser.id,
                activeChat.conversationId,
                activeChat.memberIds ?? [],
                retry.content,
              ),
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
      const decryptedSaved = await decryptApiMessage(connectedUser.id, saved);
      const serverMessage = mapApiMessage(
        decryptedSaved,
        activeChat,
        connectedUser,
        apiUsersRef.current,
      );
      if (retry.kind === "text") serverMessage.text = retry.content;
      if (retry.file) {
        serverMessage.attachment = {
          name: retry.file.name,
          size: formatFileSize(retry.file.size),
        };
      }
      setMessagesByChat((current) => ({
        ...current,
        [activeChat.id]: reconcileOptimisticMessage(
          current[activeChat.id] ?? [],
          message.id,
          serverMessage,
        ),
      }));
    } catch (reason) {
      setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: (current[activeChat.id] ?? []).map((item) =>
          isSameOptimisticMessage(item, message)
            ? { ...item, pending: false, failed: true }
          : item,
        ),
      }));
      const detail =
        reason instanceof Error ? reason.message : String(reason);
      console.error("ChatWave encrypted retry failed", reason);
      setNotice(`Повторная отправка не удалась: ${detail}`);
    }
  };

  const sendMessage = async (nativeDraft?: string) => {
    const content = (nativeDraft ?? draft).trim();
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
      false,
    );
    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: [...(current[activeChat.id] ?? []), optimisticMessage],
    }));
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              preview: content,
              time: optimisticMessage.time,
              lastActivityAt: Date.now(),
            }
          : chat,
      ),
    );
    setDraft("");
    setReplyingToId(null);
    stopTyping();
    if (activeChat.conversationId && connectedUser) {
      try {
        const encryptedContent = await encryptTextMessage(
          connectedUser.id,
          activeChat.conversationId,
          activeChat.memberIds ?? [],
          content,
        );
        const saved = await chatWaveApi.sendEncrypted(
          activeChat.conversationId,
          encryptedContent,
          optimisticMessage.clientMessageId!,
          replyToId,
        );
        const decryptedSaved = await decryptApiMessage(connectedUser.id, saved);
        const serverMessage = mapApiMessage(
          decryptedSaved,
          activeChat,
          connectedUser,
          apiUsersRef.current,
        );
        // The sender already owns the plaintext. Keeping it here also avoids a
        // visible blank/error frame if the WebSocket echo and REST ack race.
        serverMessage.text = content;
        setMessagesByChat((current) => ({
          ...current,
          [activeChat.id]: reconcileOptimisticMessage(
            current[activeChat.id] ?? [],
            optimisticMessage.id,
            serverMessage,
          ),
        }));
      } catch (reason) {
        setMessagesByChat((current) => ({
          ...current,
          [activeChat.id]: (current[activeChat.id] ?? []).map((message) =>
            isSameOptimisticMessage(message, optimisticMessage)
              ? { ...message, pending: false, failed: true }
              : message,
          ),
        }));
        const detail =
          reason instanceof Error ? reason.message : String(reason);
        console.error("ChatWave encrypted send failed", reason);
        setNotice(`Сообщение не отправлено: ${detail}`);
      }
    }
  };

  if (!hydrated || authState === "checking") {
    return (
      <main className="app-canvas session-boot" data-theme={theme}>
        <div className="aurora aurora-one" />
        <div className="aurora aurora-two" />
        <Image
          src="/chatwave-logo.svg"
          alt=""
          width={44}
          height={44}
          priority
        />
      </main>
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
      <section
        className="messenger-shell"
        style={
          {
            "--chat-sidebar-width": `${sidebarWidth}px`,
          } as CSSProperties
        }
      >
        <aside className="server-rail" aria-label="Навигация">
          <div className="brand-mark" title="ChatWave">
            <Image src="/chatwave-logo.svg" alt="ChatWave" width={42} height={42} />
          </div>
          <div className="rail-divider" />
          <button
            className={`rail-button ${navMode === "messages" ? "active" : ""}`}
            aria-label="Личные чаты"
            title="Личные чаты"
            onClick={() => switchNavigation("messages")}
          >
            <MessageCircleMore size={21} />
            {navMode === "messages" && <span className="rail-indicator" />}
          </button>
          <button
            className={`rail-button ${navMode === "groups" ? "active" : ""}`}
            aria-label="Группы"
            title="Группы"
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
        </aside>

        <ChatSidebar
          chats={visibleChats}
          selectedChatId={selectedChat}
          mobileOpen={mobileChats}
          filter={filter}
          query={query}
          unreadCount={unreadChatsCount}
          currentUser={connectedUser}
          compact={sidebarWidth <= 112}
          activeGroupCalls={
            call.phase === "idle" ? call.availableGroupCalls : []
          }
          onSelectChat={(chat) => void selectChat(chat)}
          onFilterChange={setFilter}
          onQueryChange={setQuery}
          onNewConversation={() => setNewConversationOpen(true)}
          onOpenProfile={() => {
            setProfileSettingsOpen(true);
            setMobileChats(false);
          }}
          onTogglePin={togglePinnedChat}
          onJoinGroupCall={(activeCall) =>
            void call.joinAvailableGroupCall(activeCall)
          }
          onResizeStart={resizeSidebarStart}
          onResizeMove={resizeSidebarMove}
          onResizeEnd={resizeSidebarEnd}
        />

        <section className="conversation">
          {chatBackground && (
            <div className="chat-background-layer" aria-hidden="true">
              {chatBackground.mediaType.startsWith("video/") ? (
                <video
                  src={chatBackground.url}
                  autoPlay
                  muted
                  loop
                  playsInline
                />
              ) : (
                <img src={chatBackground.url} alt="" />
              )}
              <span />
            </div>
          )}
          <header className="conversation-header">
            <button
              className="mobile-menu"
              aria-label="Назад к списку чатов"
              onClick={() => {
                if (window.history.state?.chatwaveMobileChat) {
                  window.history.back();
                } else {
                  setMobileChats(true);
                }
              }}
            >
              <ArrowLeft size={21} />
            </button>
            <span className={`avatar avatar-${activeChat.accent} header-avatar`}>
              {activeChat.type === "saved" ? (
                <Bookmark size={19} fill="currentColor" />
              ) : activeChat.avatarUrl ? (
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
              {activeChat.type !== "saved" && (
                <>
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
                    "mobile-hide-compact",
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
                </>
              )}
              {iconButton(
                "Выбрать сообщения",
                <ListChecks size={18} />,
                `mobile-hide-compact ${
                  messageSelectionActive ? "active" : ""
                }`,
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
                onOpenProfile={setViewingProfileId}
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
                onSend={(value) => void sendMessage(value)}
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
                onCancelRecording={voiceRecorder.cancel}
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
              onGroupUpdated={() => {
                const conversationId = activeChat.conversationId;
                if (!conversationId) return;
                void refreshWorkspace(connectedUser, conversationId)
                  .then(() => setNotice("Профиль группы обновлён."))
                  .catch(() =>
                    setNotice(
                      "Изменения сохранены, но список чатов пока не обновился.",
                    ),
                  );
              }}
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
      {viewingProfileId && apiUsers[viewingProfileId] && (
        <UserProfileModal
          user={apiUsers[viewingProfileId]}
          own={viewingProfileId === connectedUser.id}
          onClose={() => setViewingProfileId(null)}
          onEditOwnProfile={() => {
            setViewingProfileId(null);
            setProfileSettingsOpen(true);
          }}
          onMessage={() => {
            const userId = viewingProfileId;
            setViewingProfileId(null);
            const existingChat = chatItems.find(
              (chat) =>
                chat.type === "direct" && chat.recipientId === userId,
            );
            if (existingChat) {
              void selectChat(existingChat);
              return;
            }
            void chatWaveApi
              .createPrivateConversation(userId)
              .then((conversation) =>
                createConversationFinished(conversation.id),
              )
              .catch((reason) =>
                setNotice(
                  reason instanceof Error
                    ? reason.message
                    : "Не удалось открыть диалог.",
                ),
              );
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
          localScreenStream={call.localScreenStream}
          remoteStream={call.remoteStream}
          groupCall={call.groupCall}
          remoteStreams={call.remoteStreams}
          remoteScreenStream={call.remoteScreenStream}
          groupScreenStreams={call.groupScreenStreams}
          remoteScreenAudioStream={call.remoteScreenAudioStream}
          groupScreenAudioStreams={call.groupScreenAudioStreams}
          remoteMediaStates={call.remoteMediaStates}
          muted={call.muted}
          cameraOff={call.cameraOff}
          screenSharing={call.screenSharing}
          screenAudioSharing={call.screenAudioSharing}
          screenShareQuality={call.screenShareQuality}
          remoteScreenSharing={call.remoteScreenSharing}
          remoteScreenAudioSharing={call.remoteScreenAudioSharing}
          remoteMuted={call.remoteMuted}
          remoteCameraEnabled={call.remoteCameraEnabled}
          audioOutputDeviceId={call.audioOutputDeviceId}
          currentParticipant={{
            name: connectedUser.nickname,
            initials: connectedUser.nickname.slice(0, 2).toUpperCase(),
            avatarUrl:
              chatWaveApi.avatarUrl(connectedUser.avatar_name) ?? undefined,
          }}
          participants={Object.fromEntries(
            (callChat?.memberIds ?? []).map((userId) => {
              const participant = apiUsers[userId];
              const name =
                participant?.nickname ??
                participant?.username ??
                `Участник #${userId}`;
              return [
                userId,
                {
                  name,
                  initials: name.slice(0, 2).toUpperCase(),
                  avatarUrl:
                    chatWaveApi.avatarUrl(participant?.avatar_name) ??
                    undefined,
                },
              ];
            }),
          )}
          screenShareError={call.screenShareError}
          desktopScreenSources={call.desktopScreenSources}
          error={call.error}
          onAccept={call.accept}
          onRetry={call.retry}
          onEnd={call.end}
          onClose={call.reset}
          onToggleMute={call.toggleMute}
          onToggleCamera={call.toggleCamera}
          onToggleScreenShare={call.toggleScreenShare}
          onToggleScreenAudio={call.toggleScreenAudio}
          onScreenShareQualityChange={call.setScreenShareQuality}
          onSelectDesktopScreenSource={call.selectDesktopScreenSource}
          onCancelDesktopScreenPicker={call.cancelDesktopScreenPicker}
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
  stream,
  name,
  initials,
  avatarUrl,
  screenSharing,
  microphoneMuted,
  videoEnabled,
  local = false,
}: {
  stream: MediaStream | null;
  name: string;
  initials: string;
  avatarUrl?: string;
  screenSharing: boolean;
  microphoneMuted: boolean;
  videoEnabled: boolean;
  local?: boolean;
}) {
  const mediaElement = useRef<HTMLVideoElement>(null);
  const tile = useRef<HTMLDivElement>(null);
  const hasVideo = videoEnabled && Boolean(
    stream
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && !track.muted && track.enabled),
  );

  useEffect(() => {
    if (!mediaElement.current) return;
    mediaElement.current.srcObject = stream;
    void mediaElement.current.play().catch(() => undefined);
  }, [stream, hasVideo]);

  return (
    <div
      ref={tile}
      className={`group-video-tile ${screenSharing ? "screen-share-tile" : ""} ${
        hasVideo ? "has-video" : "voice-only"
      }`}
    >
      {hasVideo ? (
        <video
          ref={mediaElement}
          autoPlay
          muted
          playsInline
          onDoubleClick={() => {
            if (screenSharing) void tile.current?.requestFullscreen();
          }}
        />
      ) : (
        <div className="group-participant-avatar">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials}</span>}
          <i />
          <i />
        </div>
      )}
      <span>
        {microphoneMuted && <MicOff size={13} aria-label="Микрофон выключен" />}
        {name}
        {local ? " · Вы" : ""}
        {screenSharing ? " · демонстрация" : ""}
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

function StreamAudioPlayer({
  stream,
  volume,
  muted,
  outputDeviceId = "",
}: {
  stream: MediaStream;
  volume: number;
  muted: boolean;
  outputDeviceId?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!audio.current) return;
    audio.current.srcObject = stream;
    audio.current.volume = volume;
    audio.current.muted = muted;
    if ("setSinkId" in audio.current) {
      void audio.current.setSinkId(outputDeviceId).catch(() => undefined);
    }
    void audio.current.play().catch(() => undefined);
  }, [muted, outputDeviceId, stream, volume]);
  return <audio ref={audio} autoPlay />;
}

function DesktopScreenPicker({
  sources,
  onSelect,
  onCancel,
}: {
  sources: DesktopScreenSource[];
  onSelect: (sourceId: string, withAudio: boolean) => void;
  onCancel: () => void;
}) {
  const supportsSystemAudio =
    window.chatWaveDesktop?.supportsSystemAudio ?? false;
  const [withAudio, setWithAudio] = useState(false);
  const [sourceTab, setSourceTab] = useState<"window" | "screen">(
    sources.some((source) => source.kind === "window")
      ? "window"
      : "screen",
  );
  const visibleSources = sources.filter(
    (source) => source.kind === sourceTab,
  );
  return (
    <div className="desktop-screen-picker-backdrop">
      <section className="desktop-screen-picker" role="dialog" aria-modal="true">
        <header>
          <div>
            <strong>Что транслировать?</strong>
            <span>Выберите экран или окно</span>
          </div>
          <button onClick={onCancel} aria-label="Закрыть">
            <X size={19} />
          </button>
        </header>
        <nav className="desktop-screen-tabs" aria-label="Тип источника">
          <button
            className={sourceTab === "window" ? "active" : ""}
            onClick={() => setSourceTab("window")}
            disabled={!sources.some((source) => source.kind === "window")}
          >
            Отдельное окно
          </button>
          <button
            className={sourceTab === "screen" ? "active" : ""}
            onClick={() => setSourceTab("screen")}
            disabled={!sources.some((source) => source.kind === "screen")}
          >
            Весь экран
          </button>
        </nav>
        <div className="desktop-screen-grid">
          {visibleSources.map((source) => (
            <button
              key={source.id}
              onClick={() => onSelect(source.id, withAudio)}
            >
              <img src={source.thumbnail} alt="" />
              <span>
                {source.appIcon && <img src={source.appIcon} alt="" />}
                <b>{source.name}</b>
              </span>
            </button>
          ))}
        </div>
        <footer>
          <label>
            <input
              type="checkbox"
              checked={withAudio}
              disabled={!supportsSystemAudio}
              onChange={(event) => setWithAudio(event.currentTarget.checked)}
            />
            {supportsSystemAudio
              ? "Передавать системный звук"
              : "Системный звук доступен в Windows"}
          </label>
          <small>ChatWave Desktop · до 1440p / 60 FPS</small>
        </footer>
      </section>
    </div>
  );
}

function CallOverlay({
  phase,
  media,
  title,
  initials,
  localStream,
  localScreenStream,
  remoteStream,
  groupCall,
  remoteStreams,
  remoteScreenStream,
  groupScreenStreams,
  remoteScreenAudioStream,
  groupScreenAudioStreams,
  remoteMediaStates,
  muted,
  cameraOff,
  screenSharing,
  screenAudioSharing,
  screenShareQuality,
  remoteScreenSharing,
  remoteScreenAudioSharing,
  remoteMuted,
  remoteCameraEnabled,
  audioOutputDeviceId,
  currentParticipant,
  participants,
  screenShareError,
  desktopScreenSources,
  error,
  onAccept,
  onRetry,
  onEnd,
  onClose,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onToggleScreenAudio,
  onScreenShareQualityChange,
  onSelectDesktopScreenSource,
  onCancelDesktopScreenPicker,
}: {
  phase: CallPhase;
  media: CallMedia;
  title: string;
  initials: string;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remoteStream: MediaStream | null;
  groupCall: boolean;
  remoteStreams: Record<number, MediaStream>;
  remoteScreenStream: MediaStream | null;
  groupScreenStreams: Record<number, MediaStream>;
  remoteScreenAudioStream: MediaStream | null;
  groupScreenAudioStreams: Record<number, MediaStream>;
  remoteMediaStates: Record<
    number,
    {
      screenSharing: boolean;
      screenAudio: boolean;
      microphoneMuted: boolean;
      cameraEnabled: boolean;
    }
  >;
  muted: boolean;
  cameraOff: boolean;
  screenSharing: boolean;
  screenAudioSharing: boolean;
  screenShareQuality: ScreenShareQuality;
  remoteScreenSharing: boolean;
  remoteScreenAudioSharing: boolean;
  remoteMuted: boolean;
  remoteCameraEnabled: boolean;
  audioOutputDeviceId: string;
  currentParticipant: {
    name: string;
    initials: string;
    avatarUrl?: string;
  };
  participants: Record<
    number,
    { name: string; initials: string; avatarUrl?: string }
  >;
  screenShareError: string;
  desktopScreenSources: DesktopScreenSource[];
  error: string;
  onAccept: () => void;
  onRetry: () => void;
  onEnd: () => void;
  onClose: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleScreenAudio: () => void;
  onScreenShareQualityChange: (quality: ScreenShareQuality) => void;
  onSelectDesktopScreenSource: (
    sourceId: string,
    withAudio: boolean,
  ) => void;
  onCancelDesktopScreenPicker: () => void;
}) {
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const remoteScreenAudio = useRef<HTMLAudioElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const localStage = useRef<HTMLDivElement>(null);
  const remoteStage = useRef<HTMLDivElement>(null);
  const callWindow = useRef<HTMLElement>(null);
  const screenControlsTimer = useRef<number | null>(null);
  const dragState = useRef<{
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [screenFullscreen, setScreenFullscreen] = useState(false);
  const [screenControlsVisible, setScreenControlsVisible] = useState(true);
  const [viewMode, setViewMode] = useState<
    "window" | "minimized" | "fullscreen"
  >("window");
  const [remoteVoiceVolume, setRemoteVoiceVolume] = useState(1);
  const [remoteScreenVolume, setRemoteScreenVolume] = useState(1);
  const [remotePlaybackMuted, setRemotePlaybackMuted] = useState(false);
  const [volumeMenu, setVolumeMenu] = useState<{
    kind: "voice" | "screen";
    x: number;
    y: number;
  } | null>(null);
  const [localPreviewExpanded, setLocalPreviewExpanded] = useState(false);
  const [callPosition, setCallPosition] = useState({ x: 0, y: 0 });
  const [mobileCallDevice, setMobileCallDevice] = useState(false);
  const remoteHasVideo = Boolean(
    remoteStream
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && !track.muted),
  );
  const remoteHasScreenVideo = Boolean(
    remoteScreenStream
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && !track.muted),
  );
  const remoteScreenActive = remoteScreenSharing && remoteHasScreenVideo;
  const remoteVisualActive =
    remoteScreenActive || (remoteHasVideo && remoteCameraEnabled);
  const primaryRemoteVisualStream = remoteScreenActive
    ? remoteScreenStream
    : remoteStream;
  const localPreviewStream =
    screenSharing && localScreenStream ? localScreenStream : localStream;
  const localHasPreviewVideo = Boolean(
    localPreviewStream
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && track.enabled),
  );
  const groupParticipantIds = [
    ...new Set(
      [
        ...Object.keys(remoteStreams),
        ...Object.keys(remoteMediaStates),
        ...Object.keys(groupScreenStreams),
      ].map(Number),
    ),
  ];
  const groupAudioStreams = Object.entries(remoteStreams).filter(([, stream]) =>
    stream.getAudioTracks().some((track) => track.readyState === "live"),
  );

  useEffect(() => {
    setMobileCallDevice(
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
        window.matchMedia("(max-width: 760px) and (pointer: coarse)").matches,
    );
  }, []);

  useEffect(() => {
    const callActive =
      phase === "incoming" ||
      phase === "outgoing" ||
      phase === "connecting" ||
      phase === "active";
    window.ChatWaveAndroid?.setCallActive(callActive);
    return () => window.ChatWaveAndroid?.setCallActive(false);
  }, [phase]);

  useEffect(() => {
    const video = remoteVideo.current;
    const audio = remoteAudio.current;
    if (video) {
      video.srcObject = primaryRemoteVisualStream;
      video.muted = true;
      void video.play().catch(() => {
        // The next user interaction will satisfy autoplay restrictions.
      });
    }
    if (audio) {
      audio.srcObject = remoteStream;
      audio.muted = false;
      audio.volume = remoteVoiceVolume;
      if ("setSinkId" in audio) {
        void audio.setSinkId(audioOutputDeviceId).catch(() => undefined);
      }
      const play = () => void audio.play().catch(() => undefined);
      play();
      audio.addEventListener("loadedmetadata", play);
      audio.addEventListener("canplay", play);
      document.addEventListener("pointerdown", play, { once: true });
      const audioTrack = remoteStream?.getAudioTracks()[0];
      audioTrack?.addEventListener("unmute", play);
      return () => {
        audio.removeEventListener("loadedmetadata", play);
        audio.removeEventListener("canplay", play);
        document.removeEventListener("pointerdown", play);
        audioTrack?.removeEventListener("unmute", play);
      };
    }
  }, [
    audioOutputDeviceId,
    primaryRemoteVisualStream,
    remoteStream,
    remoteVoiceVolume,
    viewMode,
  ]);
  useEffect(() => {
    const screenAudio = remoteScreenAudio.current;
    if (!screenAudio) return;
    screenAudio.srcObject = remoteScreenAudioStream;
    screenAudio.muted = remotePlaybackMuted;
    screenAudio.volume = remoteScreenVolume;
    if ("setSinkId" in screenAudio) {
      void screenAudio
        .setSinkId(audioOutputDeviceId)
        .catch(() => undefined);
    }
    void screenAudio.play().catch(() => {
      // The next user interaction will satisfy autoplay restrictions.
    });
  }, [
    remotePlaybackMuted,
    audioOutputDeviceId,
    remoteScreenAudioStream,
    remoteScreenVolume,
    viewMode,
  ]);
  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = localPreviewStream;
  }, [localPreviewStream, viewMode]);
  useEffect(() => {
    if (remoteVideo.current) remoteVideo.current.volume = remoteVoiceVolume;
    if (remoteAudio.current) remoteAudio.current.volume = remoteVoiceVolume;
  }, [remoteStream, remoteVoiceVolume, viewMode]);

  useEffect(() => {
    if (!volumeMenu) return;
    const close = () => setVolumeMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [volumeMenu]);

  const openVolumeMenu = (
    event: ReactMouseEvent<HTMLElement>,
    kind: "voice" | "screen",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = callWindow.current?.getBoundingClientRect();
    setVolumeMenu({
      kind,
      x: Math.max(12, event.clientX - (rect?.left ?? 0)),
      y: Math.max(12, event.clientY - (rect?.top ?? 0)),
    });
  };
  useEffect(() => {
    const updateFullscreenState = () => {
      const isScreenFullscreen =
        document.fullscreenElement === remoteStage.current;
      setScreenFullscreen(isScreenFullscreen);
      setScreenControlsVisible(true);
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
    if (!screenFullscreen) {
      if (screenControlsTimer.current) {
        window.clearTimeout(screenControlsTimer.current);
        screenControlsTimer.current = null;
      }
      return;
    }
    screenControlsTimer.current = window.setTimeout(() => {
      setScreenControlsVisible(false);
      screenControlsTimer.current = null;
    }, 2_500);
    return () => {
      if (screenControlsTimer.current) {
        window.clearTimeout(screenControlsTimer.current);
        screenControlsTimer.current = null;
      }
    };
  }, [screenFullscreen]);
  useEffect(() => {
    if (
      !remoteScreenActive &&
      document.fullscreenElement === remoteStage.current
    ) {
      void document.exitFullscreen();
    }
  }, [remoteScreenActive]);

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

  const revealScreenControls = () => {
    if (!screenFullscreen) return;
    setScreenControlsVisible(true);
    if (screenControlsTimer.current) {
      window.clearTimeout(screenControlsTimer.current);
    }
    screenControlsTimer.current = window.setTimeout(() => {
      setScreenControlsVisible(false);
      screenControlsTimer.current = null;
    }, 2_500);
  };

  const openLocalPreviewFullscreen = async () => {
    try {
      if (document.fullscreenElement === localStage.current) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await localStage.current?.requestFullscreen();
      }
    } catch {
      setLocalPreviewExpanded(true);
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

  const startCallDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (viewMode !== "window") return;
    dragState.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: callPosition.x,
      originY: callPosition.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCall = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = callWindow.current?.getBoundingClientRect();
    const requestedX = drag.originX + event.clientX - drag.x;
    const requestedY = drag.originY + event.clientY - drag.y;
    if (!rect) {
      setCallPosition({ x: requestedX, y: requestedY });
      return;
    }
    const deltaX = requestedX - callPosition.x;
    const deltaY = requestedY - callPosition.y;
    const boundedDeltaX = Math.min(
      Math.max(deltaX, 12 - rect.left),
      window.innerWidth - 12 - rect.right,
    );
    const boundedDeltaY = Math.min(
      Math.max(deltaY, 12 - rect.top),
      window.innerHeight - 12 - rect.bottom,
    );
    setCallPosition({
      x: callPosition.x + boundedDeltaX,
      y: callPosition.y + boundedDeltaY,
    });
  };

  const stopCallDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
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

  const audioOutputs = (
    <>
      {!groupCall && remoteStream?.getAudioTracks().length ? (
        <audio ref={remoteAudio} autoPlay aria-label="Звук собеседника" />
      ) : null}
      {!groupCall && remoteScreenAudioStream && (
        <audio
          ref={remoteScreenAudio}
          autoPlay
          aria-label="Звук демонстрации"
        />
      )}
      {groupCall &&
        Object.entries(groupScreenAudioStreams).map(([userId, stream]) => (
          <StreamAudioPlayer
            key={`screen-audio-${userId}`}
            stream={stream}
            volume={remoteScreenVolume}
            muted={remotePlaybackMuted}
            outputDeviceId={audioOutputDeviceId}
          />
        ))}
      {groupCall &&
        groupAudioStreams.map(([userId, stream]) => (
          <StreamAudioPlayer
            key={`voice-${userId}`}
            stream={stream}
            volume={remoteVoiceVolume}
            muted={false}
            outputDeviceId={audioOutputDeviceId}
          />
        ))}
    </>
  );

  if (viewMode === "minimized") {
    return (
      <>
        {audioOutputs}
        <div
          className="call-backdrop call-overlay-minimized"
          role="presentation"
        >
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
      </>
    );
  }

  return (
    <>
      {audioOutputs}
      <div
      className={`call-backdrop ${
        viewMode === "fullscreen" ? "call-overlay-fullscreen" : ""
      }`}
      role="presentation"
    >
      <section
        ref={callWindow}
        className={`call-window ${media === "video" ? "video-call" : "audio-call"} ${
          groupCall ? "group-call" : ""
        } ${
          viewMode === "fullscreen" ? "call-window-fullscreen" : ""
        }`}
        role="dialog"
        style={
          viewMode === "window"
            ? {
                transform: `translate3d(${callPosition.x}px, ${callPosition.y}px, 0)`,
              }
            : undefined
        }
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
        <button
          className="call-drag-handle"
          onPointerDown={startCallDrag}
          onPointerMove={moveCall}
          onPointerUp={stopCallDrag}
          onPointerCancel={stopCallDrag}
          aria-label="Переместить окно звонка"
          title="Перетащить окно"
        >
          <span />
        </button>
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
        {groupCall ? (
          <div
            className={`group-video-grid group-video-grid-${Math.min(
              1 +
                groupParticipantIds.length +
                groupParticipantIds.filter(
                  (userId) =>
                    remoteMediaStates[userId]?.screenSharing &&
                    groupScreenStreams[userId],
                ).length +
                (screenSharing && localScreenStream ? 1 : 0),
              6,
            )}`}
          >
            <GroupStreamTile
              key="local-participant"
              stream={localStream}
              name={currentParticipant.name}
              initials={currentParticipant.initials}
              avatarUrl={currentParticipant.avatarUrl}
              screenSharing={false}
              microphoneMuted={muted}
              videoEnabled={!cameraOff}
              local
            />
            {screenSharing && localScreenStream && (
              <GroupStreamTile
                key="local-screen"
                stream={localScreenStream}
                name={`${currentParticipant.name} · Экран`}
                initials={currentParticipant.initials}
                avatarUrl={currentParticipant.avatarUrl}
                screenSharing
                microphoneMuted={muted}
                videoEnabled
                local
              />
            )}
            {groupParticipantIds.map((userId) => {
              const participant = participants[userId] ?? {
                name: `Участник #${userId}`,
                initials: String(userId).slice(-2),
              };
              return (
                <GroupStreamTile
                  key={`participant-${userId}`}
                  stream={remoteStreams[userId] ?? null}
                  name={participant.name}
                  initials={participant.initials}
                  avatarUrl={participant.avatarUrl}
                  screenSharing={false}
                  microphoneMuted={
                    remoteMediaStates[userId]?.microphoneMuted ?? false
                  }
                  videoEnabled={
                    remoteMediaStates[userId]?.cameraEnabled ?? false
                  }
                />
              );
            })}
            {groupParticipantIds
              .filter(
                (userId) =>
                  remoteMediaStates[userId]?.screenSharing &&
                  groupScreenStreams[userId],
              )
              .map((userId) => {
                const participant = participants[userId] ?? {
                  name: `Участник #${userId}`,
                  initials: String(userId).slice(-2),
                };
                return (
                  <GroupStreamTile
                    key={`screen-${userId}`}
                    stream={groupScreenStreams[userId]}
                    name={`${participant.name} · Экран`}
                    initials={participant.initials}
                    avatarUrl={participant.avatarUrl}
                    screenSharing
                    microphoneMuted={
                      remoteMediaStates[userId]?.microphoneMuted ?? false
                    }
                    videoEnabled
                  />
                );
              })}
          </div>
        ) : remoteVisualActive && primaryRemoteVisualStream ? (
          <div
            ref={remoteStage}
            className={`remote-stage ${remoteScreenActive ? "screen-share-stage" : ""}`}
            onPointerMove={revealScreenControls}
            onPointerDown={revealScreenControls}
            onContextMenu={(event) =>
              openVolumeMenu(
                event,
                remoteScreenActive ? "screen" : "voice",
              )
            }
          >
            <video
              ref={remoteVideo}
              className={`remote-video ${remoteScreenActive ? "screen-share-video" : ""}`}
              autoPlay
              muted
              playsInline
              onDoubleClick={
                remoteScreenActive ? toggleScreenFullscreen : undefined
              }
            />
            {remoteScreenActive && (
              <div
                className={`screen-stage-controls ${
                  !screenFullscreen || screenControlsVisible ? "visible" : ""
                }`}
              >
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
                <button
                  className={`screen-audio-button ${
                    remotePlaybackMuted ? "muted" : ""
                  }`}
                  onClick={() => {
                    setRemotePlaybackMuted((current) => {
                      const next = !current;
                      if (!next && remoteScreenVolume === 0) {
                        setRemoteScreenVolume(1);
                      }
                      return next;
                    });
                  }}
                  aria-label={
                    remotePlaybackMuted
                      ? "Включить звук демонстрации"
                      : "Выключить звук демонстрации"
                  }
                  title={
                    remotePlaybackMuted
                      ? "Включить звук демонстрации"
                      : "Выключить звук демонстрации"
                  }
                >
                  {remotePlaybackMuted ? (
                    <VolumeX size={20} />
                  ) : (
                    <Volume2 size={20} />
                  )}
                </button>
                {screenFullscreen && (
                  <button
                    className="screen-leave-button"
                    onClick={onEnd}
                    aria-label="Завершить звонок"
                    title="Завершить звонок"
                  >
                    <PhoneOff size={20} />
                  </button>
                )}
              </div>
            )}
          </div>
        ) : !remoteVisualActive ? (
          <div
            className="call-avatar-wrap"
            onContextMenu={(event) => openVolumeMenu(event, "voice")}
          >
            <span className="call-avatar">{initials}</span>
            <i />
            <i />
          </div>
        ) : null}

        {groupCall &&
          groupParticipantIds.some(
            (userId) => remoteMediaStates[userId]?.microphoneMuted,
          ) && (
          <div className="group-muted-list" aria-live="polite">
            {groupParticipantIds
              .filter(
                (userId) => remoteMediaStates[userId]?.microphoneMuted,
              )
              .map((userId) => (
                <span key={`muted-${userId}`}>
                  <MicOff size={14} />
                  {(participants[userId]?.name ?? `Участник #${userId}`)}{" "}
                  выключил микрофон
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
          {remoteScreenActive && (
            <small className="screen-share-status">
              Собеседник демонстрирует экран · до 1440p / 60 FPS
              {remoteScreenAudioSharing ? " · со звуком" : ""}
            </small>
          )}
          {screenSharing && (
            <small className="screen-share-status">
              Демонстрация экрана ·{" "}
              {SCREEN_SHARE_PRESETS[screenShareQuality].label}
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

        {!groupCall && localHasPreviewVideo && localPreviewStream && (
          <div
            ref={localStage}
            className={`local-preview-stage ${
              screenSharing ? "screen-share-preview" : ""
            } ${localPreviewExpanded ? "expanded" : ""}`}
          >
            <video
              ref={localVideo}
              className="local-video"
              autoPlay
              muted
              playsInline
              onDoubleClick={() => void openLocalPreviewFullscreen()}
            />
            <div className="local-preview-actions">
              <button
                onClick={() =>
                  setLocalPreviewExpanded((current) => !current)
                }
                aria-label={
                  localPreviewExpanded
                    ? "Свернуть свой предпросмотр"
                    : "Увеличить свой предпросмотр"
                }
                title={
                  localPreviewExpanded
                    ? "Вернуть миниатюру"
                    : "Увеличить"
                }
              >
                {localPreviewExpanded ? (
                  <Minimize2 size={17} />
                ) : (
                  <Maximize2 size={17} />
                )}
              </button>
              <button
                onClick={() => void openLocalPreviewFullscreen()}
                aria-label="Открыть свой предпросмотр на весь экран"
                title="На весь экран"
              >
                <ScreenShare size={17} />
              </button>
            </div>
          </div>
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
            <>
              <button className="call-button accept" onClick={onRetry}>
                <Mic size={21} />
                <span>Повторить</span>
              </button>
              <button className="call-button neutral" onClick={onClose}>
                <X size={21} />
                <span>Закрыть</span>
              </button>
            </>
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
                aria-label={cameraOff ? "Включить камеру" : "Выключить камеру"}
              >
                {cameraOff ? <VideoOff size={21} /> : <Video size={21} />}
                <span>{cameraOff ? "Включить" : "Камера"}</span>
              </button>
              {!mobileCallDevice && (
                <button
                  className={`call-button neutral mobile-screen-share-control ${
                    screenSharing ? "sharing" : ""
                  }`}
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
              )}
              {!mobileCallDevice && screenSharing && (
                <button
                  className={`call-button neutral mobile-screen-share-control ${
                    screenAudioSharing ? "sharing" : "disabled"
                  }`}
                  onClick={onToggleScreenAudio}
                  aria-label={
                    screenAudioSharing
                      ? "Выключить звук демонстрации"
                      : "Включить звук демонстрации"
                  }
                >
                  {screenAudioSharing ? (
                    <Volume2 size={21} />
                  ) : (
                    <VolumeX size={21} />
                  )}
                  <span>
                    {screenAudioSharing ? "Звук демо" : "Без звука"}
                  </span>
                </button>
              )}
              {!mobileCallDevice && (
                <label
                  className="call-quality mobile-screen-share-control"
                  title="Качество демонстрации экрана"
                >
                  <ScreenShare size={16} />
                  <select
                    value={screenShareQuality}
                    onChange={(event) =>
                      onScreenShareQualityChange(
                        event.currentTarget.value as ScreenShareQuality,
                      )
                    }
                    disabled={screenSharing}
                    aria-label="Качество демонстрации экрана"
                  >
                    {Object.entries(SCREEN_SHARE_PRESETS).map(
                      ([quality, preset]) => (
                        <option key={quality} value={quality}>
                          {preset.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}
              <label className="call-volume" title="Громкость собеседника">
                <Volume2 size={19} />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={remoteVoiceVolume}
                  onChange={(event) =>
                    setRemoteVoiceVolume(Number(event.currentTarget.value))
                  }
                  aria-label="Громкость собеседника"
                />
                <span>{Math.round(remoteVoiceVolume * 100)}%</span>
              </label>
              <button className="call-button decline" onClick={onEnd}>
                <PhoneOff size={21} />
                <span>Завершить</span>
              </button>
            </>
          )}
        </div>
        {volumeMenu && (
          <div
            className="call-volume-context"
            style={{ left: volumeMenu.x, top: volumeMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header>
              {volumeMenu.kind === "screen" ? (
                <ScreenShare size={15} />
              ) : (
                <Volume2 size={15} />
              )}
              <strong>
                {volumeMenu.kind === "screen"
                  ? "Звук демонстрации"
                  : "Громкость собеседника"}
              </strong>
            </header>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={
                volumeMenu.kind === "screen"
                  ? remoteScreenVolume
                  : remoteVoiceVolume
              }
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (volumeMenu.kind === "screen") {
                  setRemoteScreenVolume(value);
                  setRemotePlaybackMuted(value === 0);
                } else {
                  setRemoteVoiceVolume(value);
                }
              }}
            />
            <footer>
              <button
                onClick={() => {
                  if (volumeMenu.kind === "screen") {
                    setRemoteScreenVolume(0);
                    setRemotePlaybackMuted(true);
                  } else {
                    setRemoteVoiceVolume(0);
                  }
                }}
              >
                Выключить
              </button>
              <span>
                {Math.round(
                  (volumeMenu.kind === "screen"
                    ? remoteScreenVolume
                    : remoteVoiceVolume) * 100,
                )}
                %
              </span>
            </footer>
          </div>
        )}
      </section>
      {desktopScreenSources.length > 0 && (
        <DesktopScreenPicker
          sources={desktopScreenSources}
          onSelect={onSelectDesktopScreenSource}
          onCancel={onCancelDesktopScreenPicker}
        />
      )}
      </div>
    </>
  );
}
