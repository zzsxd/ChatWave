"use client";

import { useEffect, useState } from "react";
import { ApiUser, ApiUserOnline, chatWaveApi } from "../api";

export type PresenceByUser = Record<number, ApiUserOnline>;
const EMPTY_PRESENCE: PresenceByUser = {};

const indexPresence = (items: ApiUserOnline[]) =>
  Object.fromEntries(items.map((item) => [item.user_id, item])) as PresenceByUser;

export function usePresence(connectedUser: ApiUser | null) {
  const connectedUserId = connectedUser?.id;
  const [presenceState, setPresenceState] = useState<{
    userId: number;
    values: PresenceByUser;
  } | null>(null);

  useEffect(() => {
    if (!connectedUserId) return;

    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let retryDelay = 1_000;
    let pageHidden = false;

    const apply = (items: ApiUserOnline[]) => {
      if (stopped) return;
      const next = indexPresence(items);
      setPresenceState((state) => {
        const current =
          state?.userId === connectedUserId ? state.values : EMPTY_PRESENCE;
        const currentIds = Object.keys(current);
        const nextIds = Object.keys(next);
        if (
          currentIds.length === nextIds.length &&
          nextIds.every((id) => {
            const userId = Number(id);
            return (
              current[userId]?.online === next[userId]?.online &&
              current[userId]?.last_online === next[userId]?.last_online
            );
          })
        ) {
          return state;
        }
        return { userId: connectedUserId, values: next };
      });
    };

    const refresh = () => {
      if (stopped || document.visibilityState === "hidden") return;
      void chatWaveApi.onlineStatuses().then(apply).catch(() => undefined);
    };

    const connect = () => {
      if (stopped || pageHidden || socket?.readyState === WebSocket.OPEN) return;
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
        socket = null;
        if (stopped || pageHidden) return;
        reconnectTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15_000);
      };
      socket.onerror = () => socket?.close();
    };

    const handlePageHide = () => {
      pageHidden = true;
      socket?.close();
    };
    const handlePageShow = () => {
      pageHidden = false;
      refresh();
      connect();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        connect();
      }
    };

    refresh();
    connect();
    const refreshTimer = window.setInterval(refresh, 5_000);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.clearInterval(refreshTimer);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibility);
      socket?.close();
    };
  }, [connectedUserId]);

  return connectedUserId && presenceState?.userId === connectedUserId
    ? presenceState.values
    : EMPTY_PRESENCE;
}
