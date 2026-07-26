"use client";

import {
  CollectStrategy,
  DecryptionSettings,
  DeviceLists,
  EncryptionSettings,
  HistoryVisibility,
  OlmMachine,
  RequestType,
  TrustRequirement,
  UserId,
} from "@matrix-org/matrix-sdk-crypto-wasm";
import { ApiMessage, chatWaveApi } from "../api";
import {
  cryptoRoomId,
  cryptoUserId,
  getCryptoMachine,
} from "./crypto-runtime";

type MatrixRequest = {
  id: string;
  type: RequestType;
  body: string;
  event_type?: string;
  txn_id?: string;
};

const locks = new Map<string, Promise<unknown>>();
let syncCursor = "0";
let pollingAccountId: number | null = null;
let pollingTimer: number | null = null;
let initialDeviceListAccountId: number | null = null;
let syncInFlight:
  | {
      accountId: number;
      promise: Promise<void>;
    }
  | null = null;
let trackedAccountId: number | null = null;
const trackedMemberIds = new Set<number>();
const preparedRooms = new Set<string>();
const preparedRoomMessageCounts = new Map<string, number>();
const backupTimers = new Map<number, number>();

function e2eeErrorMessage(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return "неизвестная ошибка";
}

async function atE2eeStage<T>(
  stage: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (reason) {
    throw new Error(`${stage}: ${e2eeErrorMessage(reason)}`, {
      cause: reason,
    });
  }
}

async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

async function sendMatrixRequest(
  accountId: number,
  request: MatrixRequest,
) {
  const { machine, deviceId, deviceSecret } =
    await getCryptoMachine(accountId);
  const body = JSON.parse(request.body) as Record<string, unknown>;
  let response: Record<string, unknown>;
  switch (request.type) {
    case RequestType.KeysUpload:
      response = await chatWaveApi.e2eeUpload(
        deviceId,
        deviceSecret,
        body,
      );
      break;
    case RequestType.KeysQuery:
      response = await chatWaveApi.e2eeQuery(body);
      break;
    case RequestType.KeysClaim:
      response = await chatWaveApi.e2eeClaim(body);
      break;
    case RequestType.ToDevice:
      if (!request.event_type || !request.txn_id) {
        throw new Error("Некорректный E2EE to-device запрос");
      }
      response = await chatWaveApi.e2eeSendToDevice(
        request.event_type,
        request.txn_id,
        body,
      );
      break;
    default:
      throw new Error(`Неподдерживаемый E2EE запрос: ${request.type}`);
  }
  await machine.markRequestAsSent(
    request.id,
    request.type,
    JSON.stringify(response),
  );
}

async function flushOutgoing(accountId: number) {
  return locked(`outgoing:${accountId}`, async () => {
    const { machine } = await getCryptoMachine(accountId);
    for (const request of await machine.outgoingRequests()) {
      await sendMatrixRequest(accountId, request as MatrixRequest);
    }
  });
}

export function syncCrypto(accountId: number): Promise<void> {
  if (syncInFlight?.accountId === accountId) {
    return syncInFlight.promise;
  }

  const promise = locked(`machine:${accountId}`, async () => {
    const { machine, deviceId, deviceSecret } =
      await getCryptoMachine(accountId);
    await flushOutgoing(accountId);
    const response = await chatWaveApi.e2eeSync(
      deviceId,
      deviceSecret,
      syncCursor,
    );
    const hasNewEvents =
      response.next_batch !== syncCursor ||
      response.to_device.events.length > 0;
    if (hasNewEvents) {
      for (const roomKey of preparedRooms) {
        if (roomKey.startsWith(`${accountId}:`)) {
          preparedRooms.delete(roomKey);
          preparedRoomMessageCounts.delete(roomKey);
        }
      }
    }
    const includeDeviceChanges =
      initialDeviceListAccountId !== accountId || hasNewEvents;
    const changed = (
      includeDeviceChanges ? response.device_lists.changed : []
    ).map(
      (userId) => new UserId(userId),
    );
    const left = response.device_lists.left.map(
      (userId) => new UserId(userId),
    );
    await machine.receiveSyncChanges(
      JSON.stringify(response.to_device.events),
      new DeviceLists(changed, left),
      new Map(Object.entries(response.device_one_time_keys_count)),
      new Set(response.device_unused_fallback_key_types),
    );
    initialDeviceListAccountId = accountId;
    syncCursor = response.next_batch;
    await chatWaveApi.e2eeAcknowledge(
      deviceId,
      deviceSecret,
      response.next_batch,
    );
    await flushOutgoing(accountId);
    scheduleKeyBackup(accountId);
  });
  syncInFlight = { accountId, promise };
  const clearInFlight = () => {
    if (syncInFlight?.promise === promise) syncInFlight = null;
  };
  void promise.then(clearInFlight, clearInFlight);
  return promise;
}

export async function initializeCrypto(
  accountId: number,
  memberIds: number[],
) {
  if (pollingAccountId !== accountId) {
    if (pollingTimer !== null) window.clearInterval(pollingTimer);
    pollingAccountId = accountId;
    syncCursor = "0";
    initialDeviceListAccountId = null;
  }
  if (trackedAccountId !== accountId) {
    trackedAccountId = accountId;
    trackedMemberIds.clear();
  }
  const uniqueMemberIds = [...new Set([accountId, ...memberIds])];
  await locked(`machine:${accountId}`, async () => {
    const { machine } = await getCryptoMachine(accountId);
    await machine.updateTrackedUsers(
      uniqueMemberIds.map(
        (userId) => new UserId(cryptoUserId(userId)),
      ),
    );
  });
  uniqueMemberIds.forEach((userId) => trackedMemberIds.add(userId));
  await syncCrypto(accountId);

  if (pollingTimer === null) {
    pollingTimer = window.setInterval(() => {
      void syncCrypto(accountId).catch(() => undefined);
    }, 10_000);
  }
}

export function stopCryptoPolling() {
  if (pollingTimer !== null) window.clearInterval(pollingTimer);
  pollingTimer = null;
  pollingAccountId = null;
  syncCursor = "0";
  initialDeviceListAccountId = null;
  syncInFlight = null;
  trackedAccountId = null;
  trackedMemberIds.clear();
  preparedRooms.clear();
  preparedRoomMessageCounts.clear();
  backupTimers.forEach((timer) => window.clearTimeout(timer));
  backupTimers.clear();
}

function recoveryStorageKey(accountId: number) {
  return `chatwave_e2ee_recovery_key_${accountId}`;
}

function randomRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function localRecoveryKey(accountId: number) {
  return localStorage.getItem(recoveryStorageKey(accountId));
}

export async function backupRoomKeys(
  accountId: number,
  recoveryKey = localRecoveryKey(accountId),
) {
  if (!recoveryKey) throw new Error("Сначала создайте ключ восстановления");
  const { machine } = await getCryptoMachine(accountId);
  const exported = await machine.exportRoomKeys(() => true);
  const encrypted = OlmMachine.encryptExportedRoomKeys(
    exported,
    recoveryKey,
    200_000,
  );
  await chatWaveApi.e2eeSaveBackup(encrypted);
  localStorage.setItem(recoveryStorageKey(accountId), recoveryKey);
}

export async function createRecoveryKey(accountId: number) {
  const key = randomRecoveryKey();
  await backupRoomKeys(accountId, key);
  return key;
}

export async function restoreRoomKeys(
  accountId: number,
  recoveryKey: string,
) {
  const backup = await chatWaveApi.e2eeBackup();
  const exported = OlmMachine.decryptExportedRoomKeys(
    backup.encrypted_data,
    recoveryKey.trim(),
  );
  const { machine } = await getCryptoMachine(accountId);
  await machine.importRoomKeys(exported, () => undefined);
  localStorage.setItem(recoveryStorageKey(accountId), recoveryKey.trim());
  await backupRoomKeys(accountId, recoveryKey.trim());
}

export function scheduleKeyBackup(accountId: number) {
  if (!localRecoveryKey(accountId) || backupTimers.has(accountId)) return;
  const timer = window.setTimeout(() => {
    backupTimers.delete(accountId);
    void backupRoomKeys(accountId).catch(() => undefined);
  }, 30_000);
  backupTimers.set(accountId, timer);
}

async function prepareRoomEncryptionUnlocked(
  accountId: number,
  conversationId: number,
  memberIds: number[],
) {
  const { machine } = await getCryptoMachine(accountId);
  const uniqueMemberIds = [...new Set([accountId, ...memberIds])];
  const roomPreparationKey = `${accountId}:${conversationId}:${uniqueMemberIds
    .slice()
    .sort((left, right) => left - right)
    .join(",")}`;
  if (
    trackedAccountId !== accountId ||
    uniqueMemberIds.some((userId) => !trackedMemberIds.has(userId))
  ) {
    trackedAccountId = accountId;
    await atE2eeStage("обновление устройств", () =>
      machine.updateTrackedUsers(
        uniqueMemberIds.map(
          (userId) => new UserId(cryptoUserId(userId)),
        ),
      ),
    );
    uniqueMemberIds.forEach((userId) => trackedMemberIds.add(userId));
    await atE2eeStage("синхронизация устройств", () =>
      flushOutgoing(accountId),
    );
  }

  if (!preparedRooms.has(roomPreparationKey)) {
    const missingSessions = await atE2eeStage(
      "проверка E2EE-сессий",
      () =>
        machine.getMissingSessions(
          uniqueMemberIds.map(
            (userId) => new UserId(cryptoUserId(userId)),
          ),
        ),
    );
    if (missingSessions) {
      await atE2eeStage("создание E2EE-сессий", () =>
        sendMatrixRequest(accountId, missingSessions as MatrixRequest),
      );
    }

    const settings = new EncryptionSettings();
    settings.historyVisibility = HistoryVisibility.Joined;
    settings.sharingStrategy = CollectStrategy.allDevices();
    settings.rotationPeriodMessages = BigInt(100);
    settings.rotationPeriod = BigInt(604_800_000_000);
    const roomId = cryptoRoomId(conversationId);
    // The persisted Matrix store may remember that an older outbound Megolm
    // session was shared even when a recipient has recreated its local crypto
    // store. Rotate once per prepared room so every currently registered
    // device receives a fresh room key before the next message is encrypted.
    await atE2eeStage("ротация ключа комнаты", () =>
      machine.invalidateGroupSession(roomId),
    );
    const keyRequests = await atE2eeStage(
      "подготовка ключа комнаты",
      () => machine.shareRoomKey(
        roomId,
        // Matrix WASM invalidates every UserId passed to
        // getMissingSessions(), so shareRoomKey() must receive fresh objects.
        uniqueMemberIds.map(
          (userId) => new UserId(cryptoUserId(userId)),
        ),
        settings,
      ),
    );
    for (const request of keyRequests) {
      await atE2eeStage("доставка ключа комнаты", () =>
        sendMatrixRequest(accountId, request as MatrixRequest),
      );
    }
    preparedRooms.add(roomPreparationKey);
    preparedRoomMessageCounts.set(roomPreparationKey, 0);
  }
  return { machine, roomPreparationKey };
}

export async function encryptTextMessage(
  accountId: number,
  conversationId: number,
  memberIds: number[],
  content: string,
) {
  return locked(`machine:${accountId}`, async () => {
    const { machine, roomPreparationKey } =
      await prepareRoomEncryptionUnlocked(
        accountId,
        conversationId,
        memberIds,
      );

    const encrypted = await atE2eeStage(
      "шифрование сообщения",
      () => machine.encryptRoomEvent(
        cryptoRoomId(conversationId),
        "m.room.message",
        JSON.stringify({ msgtype: "m.text", body: content }),
      ),
    );
    const roomMessageCount =
      (preparedRoomMessageCounts.get(roomPreparationKey) ?? 0) + 1;
    preparedRoomMessageCounts.set(roomPreparationKey, roomMessageCount);
    // Re-share before the configured 100-message Megolm rotation.
    if (roomMessageCount >= 90) {
      preparedRooms.delete(roomPreparationKey);
      preparedRoomMessageCounts.delete(roomPreparationKey);
    }
    scheduleKeyBackup(accountId);
    return JSON.parse(encrypted) as Record<string, unknown>;
  });
}

async function decryptWithoutSync(
  accountId: number,
  message: ApiMessage,
): Promise<ApiMessage> {
  if (!message.encrypted_content || !message.encryption_algorithm) {
    return message;
  }
  try {
    const decrypted = await locked(`machine:${accountId}`, async () => {
      const { machine } = await getCryptoMachine(accountId);
      return machine.decryptRoomEvent(
        JSON.stringify({
          event_id: `$chatwave-${message.id}:chatwave.local`,
          type: "m.room.encrypted",
          sender: cryptoUserId(message.sender_id),
          origin_server_ts: message.created_at
            ? new Date(message.created_at).getTime()
            : Date.now(),
          content: message.encrypted_content,
        }),
        cryptoRoomId(message.conversation_id),
        new DecryptionSettings(TrustRequirement.Untrusted),
      );
    });
    if (decrypted.sender.toString() !== cryptoUserId(message.sender_id)) {
      throw new Error("E2EE sender mismatch");
    }
    const event = JSON.parse(decrypted.event) as {
      type?: string;
      content?: { body?: unknown };
    };
    if (
      event.type !== "m.room.message" ||
      typeof event.content?.body !== "string"
    ) {
      throw new Error("Unsupported encrypted event");
    }
    return { ...message, content: event.content.body };
  } catch {
    return {
      ...message,
      content: "Не удалось расшифровать сообщение на этом устройстве",
    };
  }
}

export async function decryptApiMessage(
  accountId: number,
  message: ApiMessage,
) {
  if (!message.encrypted_content) return message;
  await syncCrypto(accountId).catch(() => undefined);
  return decryptWithoutSync(accountId, message);
}

export async function decryptApiMessages(
  accountId: number,
  messages: ApiMessage[],
) {
  await syncCrypto(accountId).catch(() => undefined);
  return Promise.all(
    messages.map((message) => decryptWithoutSync(accountId, message)),
  );
}
