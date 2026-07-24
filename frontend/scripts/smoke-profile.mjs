const apiUrl = (process.env.CHATWAVE_API_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);
const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
const originalUsername = `profile_${suffix}`;
const updatedUsername = `profile_updated_${suffix}`;
const originalPassword = `Profile-${suffix}-Aa1!`;
const updatedPassword = `Updated-${suffix}-Bb2!`;

async function request(path, init = {}, token, expected = [200, 201, 202, 204]) {
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
  if (!expected.includes(response.status)) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`,
    );
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined;
  }
  return response.json();
}

async function login(username, password, expected = [200]) {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });
  if (!expected.includes(response.status)) {
    throw new Error(`login: ${response.status} ${await response.text()}`);
  }
  return response.status === 200 ? (await response.json()).access_token : null;
}

let token;
try {
  await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      nickname: "Profile Smoke",
      username: originalUsername,
      password: originalPassword,
    }),
  });
  token = await login(originalUsername, originalPassword);

  await request(
    "/users/me",
    {
      method: "PATCH",
      body: JSON.stringify({
        nickname: "Profile Updated",
        username: updatedUsername,
        bio: "Профиль настроен",
        birthday: "2000-01-02",
      }),
    },
    token,
  );
  let profile = await request("/users/me", {}, token);
  if (
    profile.nickname !== "Profile Updated" ||
    profile.username !== updatedUsername ||
    profile.bio !== "Профиль настроен" ||
    profile.birthday !== "2000-01-02"
  ) {
    throw new Error("Profile fields were not persisted");
  }

  const jpeg = await readFile(
    new URL("../../tests/media/users_avatars/valid.jpg", import.meta.url),
  );
  const avatar = new FormData();
  avatar.append(
    "avatar",
    new Blob([jpeg], { type: "image/jpeg" }),
    "avatar.jpg",
  );
  await request("/users/me/avatar", { method: "PUT", body: avatar }, token);
  profile = await request("/users/me", {}, token);
  if (!profile.avatar_name) throw new Error("Avatar metadata was not saved");
  const avatarResponse = await fetch(
    `${apiUrl}/users/avatar/${encodeURIComponent(profile.avatar_name)}`,
  );
  if (
    !avatarResponse.ok ||
    avatarResponse.headers.get("content-type") !== "image/jpeg"
  ) {
    throw new Error("Avatar was not served with the correct MIME type");
  }
  await request("/users/me/avatar", { method: "DELETE" }, token);

  await request(
    "/users/me/password",
    {
      method: "PUT",
      body: JSON.stringify({
        current_password: "Wrong-password-Aa1",
        new_password: updatedPassword,
      }),
    },
    token,
    [401],
  );
  await request(
    "/users/me/password",
    {
      method: "PUT",
      body: JSON.stringify({
        current_password: originalPassword,
        new_password: updatedPassword,
      }),
    },
    token,
  );
  await login(updatedUsername, originalPassword, [404]);
  token = await login(updatedUsername, updatedPassword);
  console.log("Profile fields, avatar lifecycle and password rotation: OK");
} finally {
  if (token) {
    await request("/users/me", { method: "DELETE" }, token).catch(() => undefined);
  }
}
import { readFile } from "node:fs/promises";
