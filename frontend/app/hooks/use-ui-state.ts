"use client";

import { useState } from "react";

export type NavigationMode = "messages" | "groups" | "mentions";
export type ChatFilter = "all" | "unread";

export function useUiState() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [navMode, setNavMode] = useState<NavigationMode>("messages");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [query, setQuery] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [mobileChatsOpen, setMobileChatsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const setNavigation = (mode: NavigationMode) => {
    setNavMode(mode);
    setFilter(mode === "mentions" ? "unread" : "all");
    setQuery("");
  };

  return {
    theme,
    navMode,
    filter,
    query,
    detailsOpen,
    mobileChatsOpen,
    profileOpen,
    setTheme,
    setNavigation,
    setFilter,
    setQuery,
    setDetailsOpen,
    setMobileChatsOpen,
    setProfileOpen,
  };
}
