"use client";

export const CHAT_BACKGROUND_EVENT = "chatwave:chat-background";

type StoredBackground = {
  blob: Blob;
  mediaType: string;
};

const DB_NAME = "chatwave-ui";
const STORE_NAME = "chat-backgrounds";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadChatBackground(
  userId: number,
): Promise<StoredBackground | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(userId);
      request.onsuccess = () =>
        resolve((request.result as StoredBackground | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function saveChatBackground(
  userId: number,
  file: File | null,
) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (file) {
        store.put({ blob: file, mediaType: file.type }, userId);
      } else {
        store.delete(userId);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
  window.dispatchEvent(
    new CustomEvent(CHAT_BACKGROUND_EVENT, { detail: { userId } }),
  );
}
