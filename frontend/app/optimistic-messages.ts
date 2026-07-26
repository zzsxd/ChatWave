import { Message, formatFileSize } from "./models";

const messageTime = () =>
  new Date().toLocaleTimeString("ru", {
    hour: "2-digit",
    minute: "2-digit",
  });

export function optimisticTextMessage(
  id: number,
  content: string,
  replyToId: number | undefined,
  pending: boolean,
): Message {
  const clientMessageId = crypto.randomUUID();
  return {
    id,
    author: "Вы",
    initials: "Я",
    time: messageTime(),
    text: content,
    accent: "blue",
    own: true,
    pending,
    clientMessageId,
    replyToId,
    messageType: "text",
    retry: { kind: "text", content, clientMessageId, replyToId },
  };
}

export function optimisticMediaMessage(
  id: number,
  file: File,
  content: string,
  replyToId: number | undefined,
  isVoice: boolean,
): Message {
  const clientMessageId = crypto.randomUUID();
  return {
    id,
    author: "Вы",
    initials: "Я",
    time: messageTime(),
    text: content,
    accent: "blue",
    own: true,
    pending: true,
    clientMessageId,
    replyToId,
    messageType: isVoice ? "voice" : "file",
    attachment: { name: file.name, size: formatFileSize(file.size) },
    retry: {
      kind: "media",
      content,
      clientMessageId,
      replyToId,
      file,
      isVoice,
    },
  };
}

export function reconcileOptimisticMessage(
  current: Message[],
  optimisticId: number,
  serverMessage: Message,
): Message[] {
  let reconciled = false;
  const next = current.flatMap((message) => {
    const sameMessage =
      message.id === optimisticId ||
      message.id === serverMessage.id ||
      Boolean(
        serverMessage.clientMessageId &&
          message.clientMessageId === serverMessage.clientMessageId,
      );
    if (!sameMessage) return [message];
    if (reconciled) return [];
    reconciled = true;
    return [
      {
        ...message,
        ...serverMessage,
        attachment: serverMessage.attachment ?? message.attachment,
        pending: false,
        failed: false,
        retry: undefined,
      },
    ];
  });

  if (!reconciled) next.push(serverMessage);
  return next;
}
