const apiUrl = (process.env.CHATWAVE_API_URL ?? "http://chatwave:8000").replace(
  /\/$/,
  "",
);
const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
const password = `Presence-${suffix}-Aa1!`;

async function request(path, init = {}, token) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
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

async function createUser(label) {
  const username = `${label}_${suffix}`;
  await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      nickname: `${label} Presence`,
      username,
      password,
    }),
  });
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });
  if (!response.ok) throw new Error(`login ${label}: ${response.status}`);
  const token = (await response.json()).access_token;
  return { token, profile: await request("/users/me", {}, token) };
}

function waitForPresence(socket, userId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Presence snapshot timed out")),
      8_000,
    );
    socket.addEventListener("message", (event) => {
      const items = JSON.parse(event.data);
      const presence = items.find((item) => item.user_id === userId);
      if (!presence?.online) return;
      clearTimeout(timeout);
      resolve(presence);
    });
  });
}

let first;
let second;
let firstSocket;
let secondSocket;
try {
  first = await createUser("first");
  second = await createUser("second");
  const conversation = await request(
    `/conversations/chat?recipient_id=${second.profile.id}`,
    { method: "POST" },
    first.token,
  );

  const wsUrl = `${apiUrl.replace(/^http/, "ws")}/users/ws/online`;
  firstSocket = new WebSocket(wsUrl, ["bearer", first.token]);
  await new Promise((resolve, reject) => {
    firstSocket.addEventListener("open", resolve, { once: true });
    firstSocket.addEventListener("error", reject, { once: true });
  });
  secondSocket = new WebSocket(wsUrl, ["bearer", second.token]);
  const presencePromise = waitForPresence(secondSocket, first.profile.id);
  await new Promise((resolve, reject) => {
    secondSocket.addEventListener("open", resolve, { once: true });
    secondSocket.addEventListener("error", reject, { once: true });
  });
  const presence = await presencePromise;
  if (!presence.last_online) {
    throw new Error("Last-online timestamp is missing");
  }

  const marker = `searchable-${suffix}`;
  const message = await request(
    `/conversations/${conversation.id}/text`,
    {
      method: "POST",
      body: JSON.stringify({ content: marker }),
    },
    first.token,
  );
  const results = await request(
    `/conversations/${conversation.id}/messages/search?search_query=${marker}&limit=50`,
    {},
    second.token,
  );
  if (!results.some((item) => item.id === message.id)) {
    throw new Error("Message search did not return the expected message");
  }

  await request(
    `/messages?messages_ids=${message.id}`,
    { method: "DELETE" },
    second.token,
  );
  const remaining = await request(
    `/conversations/${conversation.id}/messages?limit=50&offset=0`,
    {},
    first.token,
  );
  if (remaining.some((item) => item.id === message.id)) {
    throw new Error("Another participant could not delete the message");
  }

  console.log("Chat search, cross-participant deletion and presence: OK");
} finally {
  firstSocket?.close();
  secondSocket?.close();
  if (first?.token) {
    await request("/users/me", { method: "DELETE" }, first.token).catch(
      () => undefined,
    );
  }
  if (second?.token) {
    await request("/users/me", { method: "DELETE" }, second.token).catch(
      () => undefined,
    );
  }
}
