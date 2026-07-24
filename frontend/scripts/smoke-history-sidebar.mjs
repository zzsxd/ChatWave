import { readFile } from "node:fs/promises";

const apiUrl = (process.env.CHATWAVE_API_URL ?? "http://chatwave:8000").replace(
  /\/$/,
  "",
);
const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
const username = `history_${suffix}`;
const password = `History-${suffix}-Aa1!`;

async function request(path, init = {}, token) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(!(init.body instanceof FormData) && init.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`,
    );
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined;
  }
  return response.json();
}

async function uploadAvatar(jpeg, fileName, token) {
  const body = new FormData();
  body.append("avatar", new Blob([jpeg], { type: "image/jpeg" }), fileName);
  await request("/users/me/avatar", { method: "PUT", body }, token);
  return request("/users/me", {}, token);
}

let token;
try {
  await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      nickname: "History Smoke",
      username,
      password,
    }),
  });
  const loginResponse = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });
  if (!loginResponse.ok) {
    throw new Error(`login: ${loginResponse.status} ${await loginResponse.text()}`);
  }
  token = (await loginResponse.json()).access_token;
  const me = await request("/users/me", {}, token);
  const jpeg = await readFile(
    new URL("../../tests/media/users_avatars/valid.jpg", import.meta.url),
  );

  const firstProfile = await uploadAvatar(jpeg, "first.jpg", token);
  const secondProfile = await uploadAvatar(jpeg, "second.jpg", token);
  if (firstProfile.avatar_name === secondProfile.avatar_name) {
    throw new Error("Avatar uploads did not produce distinct history entries");
  }

  let history = await request(`/users/${me.id}/avatar-history`, {}, token);
  if (
    history.length !== 2 ||
    !history.some((item) => item.avatar_name === secondProfile.avatar_name && item.current)
  ) {
    throw new Error("Avatar history or current marker is invalid");
  }
  await request(
    `/users/me/avatar/${encodeURIComponent(firstProfile.avatar_name)}`,
    { method: "PUT" },
    token,
  );
  history = await request(`/users/${me.id}/avatar-history`, {}, token);
  if (!history.some((item) => item.avatar_name === firstProfile.avatar_name && item.current)) {
    throw new Error("Previous avatar was not restored");
  }

  const group = await request(
    "/conversations/group",
    {
      method: "POST",
      body: JSON.stringify({ name: `History ${suffix}`, description: null }),
    },
    token,
  );
  const imageBody = new FormData();
  imageBody.append("file", new Blob([jpeg], { type: "image/jpeg" }), "pinned.jpg");
  const imageMessage = await request(
    `/conversations/${group.id}/media?is_voice_message=false`,
    { method: "POST", body: imageBody },
    token,
  );

  await request(`/messages/${imageMessage.id}/pin`, { method: "PUT" }, token);
  const [media, pinned] = await Promise.all([
    request(`/conversations/${group.id}/media?kind=media&limit=100`, {}, token),
    request(`/conversations/${group.id}/pinned`, {}, token),
  ]);
  if (!media.some((message) => message.id === imageMessage.id)) {
    throw new Error("Conversation media collection does not contain the image");
  }
  if (!pinned.some((message) => message.id === imageMessage.id)) {
    throw new Error("Pinned collection does not contain the pinned image");
  }

  await request(`/messages/${imageMessage.id}/pin`, { method: "DELETE" }, token);
  const afterUnpin = await request(`/conversations/${group.id}/pinned`, {}, token);
  if (afterUnpin.some((message) => message.id === imageMessage.id)) {
    throw new Error("Message remained pinned after unpin");
  }

  console.log("Avatar history, restore, media collection and pins: OK");
} finally {
  if (token) {
    await request("/users/me", { method: "DELETE" }, token).catch(() => undefined);
  }
}
