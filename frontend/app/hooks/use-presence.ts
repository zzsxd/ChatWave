"use client";

import { useEffect, useState } from "react";
import { ApiUser, ApiUserOnline, chatWaveApi } from "../api";

export type PresenceByUser = Record<number, ApiUserOnline>;

const indexPresence = (items: ApiUserOnline[]) =>
  Object.fromEntries(items.map((item) => [item.user_id, item])) as PresenceByUser;

export function usePresence(connectedUser: ApiUser | null) {
  const [presence, setPresence] = useState<PresenceByUser>({});

  useEffect(() => {
    if (!connectedUser) {
      setPresence({});
      return;
    }

    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let retryDelay = 1_000;

    const apply = (items: ApiUserOnline[]) => {
      if (!stopped) setPresence(indexPresence(items));
    };

    void chatWaveApi.onlineStatuses().then(apply).catch(() => undefined);

    const connect = () => {
      if (stopped) return;
      try {
        socket = chatWaveApi.onlineSocket();
      } catch {
        return;
      }
      socket.onopen = () => {
        retryDelay = 1_000;
      };
      socket.onmessage = (event) => {
        try {
          apply(JSON.parse(event.data) as ApiUserOnline[]);
        } catch {
          // Ignore malformed presence frames and keep the last valid snapshot.
        }
      };
      socket.onclose = () => {
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
    };
  }, [connectedUser]);

  return presence;
}
