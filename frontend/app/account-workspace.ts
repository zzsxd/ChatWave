import { QueryClient } from "@tanstack/react-query";
import { ApiMessage, ApiUser, chatWaveApi } from "./api";
import { Chat } from "./models";

export type AccountWorkspace = {
  users: Record<number, ApiUser>;
  chats: Chat[];
  initialMessages: ApiMessage[];
};

export async function loadAccountWorkspace(
  user: ApiUser,
  queryClient: QueryClient,
): Promise<AccountWorkspace> {
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
  const members = memberIds.length ? await chatWaveApi.users(memberIds) : [];
  const usersById = new Map(members.map((member) => [member.id, member]));
  const users = Object.fromEntries(
    members.map((member) => [member.id, member]),
  ) as Record<number, ApiUser>;
  users[user.id] = user;

  const unreadMessages = await chatWaveApi.unreadMessages().catch(() => []);
  const lastMessages = await Promise.all(
    conversations.map((conversation) =>
      chatWaveApi.lastMessage(conversation.id).catch(() => null),
    ),
  );
  const unreadByConversation = unreadMessages.reduce<Record<number, number>>(
    (result, unread) => {
      if (unread.message_id) {
        result[unread.conversation_id] =
          (result[unread.conversation_id] ?? 0) + 1;
      }
      return result;
    },
    {},
  );

  const chats: Chat[] = conversations.map((conversation, index) => {
    const lastMessage = lastMessages[index];
    const recipientId = conversation.members.find(
      (member) => member.user_id !== user.id,
    )?.user_id;
    const recipient = recipientId ? usersById.get(recipientId) : undefined;
    const title =
      conversation.type === "private"
        ? recipient?.nickname ?? `Пользователь #${recipientId ?? "—"}`
        : conversation.name ?? `Группа #${conversation.id}`;
    return {
      id: `api-${conversation.id}`,
      conversationId: conversation.id,
      recipientId,
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
      preview:
        lastMessage?.content?.trim() ||
        (lastMessage?.original_file_name
          ? `Файл: ${lastMessage.original_file_name}`
          : conversation.type === "private"
            ? "Личный чат"
            : "Групповой чат"),
      time: lastMessage?.created_at
        ? new Date(lastMessage.created_at).toLocaleTimeString("ru", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "",
      unread: unreadByConversation[conversation.id] || undefined,
      online: false,
      accent: ["blue", "violet", "cyan", "green"][index % 4],
      type: conversation.type === "private" ? "direct" : "group",
      description:
        conversation.type === "private"
            ? ""
          : conversation.description ?? "Групповое пространство",
      memberCount: conversation.members.length,
      onlineCount: conversation.type === "private" ? 1 : 1,
      avatarUrl:
        conversation.type === "private"
          ? chatWaveApi.avatarUrl(recipient?.avatar_name) ?? undefined
          : undefined,
    };
  });

  const initialMessages = chats.length
    ? await chatWaveApi.messages(chats[0].conversationId!)
    : [];
  return { users, chats, initialMessages };
}
