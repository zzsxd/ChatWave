import { QueryClient } from "@tanstack/react-query";
import { ApiMessage, ApiUser, chatWaveApi } from "./api";
import { Chat, apiMessagePreview } from "./models";

export type AccountWorkspace = {
  users: Record<number, ApiUser>;
  chats: Chat[];
  loadInitialMessages: () => Promise<ApiMessage[]>;
  loadMetadata: () => Promise<AccountWorkspaceMetadata>;
};

export type AccountWorkspaceMetadata = {
  lastMessages: Record<number, ApiMessage | null>;
  unreadByConversation: Record<number, number>;
};

export async function loadAccountWorkspace(
  user: ApiUser,
  queryClient: QueryClient,
): Promise<AccountWorkspace> {
  await chatWaveApi.savedConversation().catch(() => undefined);
  const conversations = await queryClient.fetchQuery({
    queryKey: ["conversations", user.id],
    queryFn: () => chatWaveApi.conversations(),
  });
  const memberIds = [
    ...new Set(
      conversations.flatMap((conversation) =>
        conversation.members.map((member) => member.user_id),
      ),
    ),
  ];
  const members = memberIds.length
    ? await chatWaveApi.users(memberIds).catch(() => [])
    : [];
  const usersById = new Map(members.map((member) => [member.id, member]));
  const users = Object.fromEntries(
    members.map((member) => [member.id, member]),
  ) as Record<number, ApiUser>;
  users[user.id] = user;

  const chats: Chat[] = conversations.map((conversation, index) => {
    const saved =
      conversation.type === "group" &&
      conversation.description === "__chatwave_saved__" &&
      conversation.members.length === 1 &&
      conversation.members[0]?.user_id === user.id;
    const recipientId = conversation.members.find(
      (member) => member.user_id !== user.id,
    )?.user_id;
    const recipient = recipientId ? usersById.get(recipientId) : undefined;
    const title =
      saved
        ? "Избранное"
        : conversation.type === "private"
        ? recipient?.nickname ?? `Пользователь #${recipientId ?? "—"}`
        : conversation.name ?? `Группа #${conversation.id}`;
    return {
      id: `api-${conversation.id}`,
      conversationId: conversation.id,
      recipientId,
      recipientUsername: recipient?.username,
      memberIds: conversation.members.map((member) => member.user_id),
      memberRoles: Object.fromEntries(
        conversation.members.map((member) => [
          member.user_id,
          member.user_role,
        ]),
      ),
      currentUserRole: conversation.members.find(
        (member) => member.user_id === user.id,
      )?.user_role,
      title,
      initials: title.slice(0, 2).toUpperCase(),
      preview: conversation.type === "private" ? "Личный чат" : "Групповой чат",
      time: "",
      lastActivityAt: new Date(
        conversation.updated_at ?? conversation.created_at,
      ).getTime(),
      online: false,
      accent: ["blue", "violet", "cyan", "green"][index % 4],
      type: saved
        ? "saved"
        : conversation.type === "private"
          ? "direct"
          : "group",
      description:
        saved || conversation.type === "private"
          ? ""
          : conversation.description ?? "Групповое пространство",
      memberCount: conversation.members.length,
      onlineCount: conversation.type === "private" ? 1 : 1,
      avatarUrl:
        saved
          ? chatWaveApi.avatarUrl(user.avatar_name) ?? undefined
          : conversation.type === "private"
          ? chatWaveApi.avatarUrl(recipient?.avatar_name) ?? undefined
          : chatWaveApi.groupAvatarUrl(
              conversation.id,
              conversation.avatar_name,
            ) ?? undefined,
    };
  });

  const loadInitialMessages = () =>
    chats.length
      ? chatWaveApi.messages(chats[0].conversationId!)
      : Promise.resolve([]);
  const loadMetadata = async (): Promise<AccountWorkspaceMetadata> => {
    const [unreadMessages, lastMessages] = await Promise.all([
      chatWaveApi.unreadMessages().catch(() => []),
      Promise.all(
        conversations.map((conversation) =>
          chatWaveApi.lastMessage(conversation.id).catch(() => null),
        ),
      ),
    ]);
    return {
      lastMessages: Object.fromEntries(
        conversations.map((conversation, index) => [
          conversation.id,
          lastMessages[index],
        ]),
      ),
      unreadByConversation: unreadMessages.reduce<Record<number, number>>(
        (result, unread) => {
          if (unread.message_id) {
            result[unread.conversation_id] =
              (result[unread.conversation_id] ?? 0) + 1;
          }
          return result;
        },
        {},
      ),
    };
  };

  return { users, chats, loadInitialMessages, loadMetadata };
}

export function applyWorkspaceMetadata(
  chats: Chat[],
  metadata: AccountWorkspaceMetadata,
  currentUserId: number,
): Chat[] {
  return chats.map((chat) => {
    if (!chat.conversationId) return chat;
    const lastMessage = metadata.lastMessages[chat.conversationId];
    return {
      ...chat,
      preview:
        apiMessagePreview(lastMessage, currentUserId) ||
        (chat.type === "direct" ? "Личный чат" : "Групповой чат"),
      time: lastMessage?.created_at
        ? new Date(lastMessage.created_at).toLocaleTimeString("ru", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "",
      lastActivityAt: lastMessage?.created_at
        ? new Date(lastMessage.created_at).getTime()
        : chat.lastActivityAt,
      unread:
        metadata.unreadByConversation[chat.conversationId] || undefined,
    };
  });
}
