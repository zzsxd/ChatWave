import WebSocket from "ws";

const apiUrl = (process.env.CHATWAVE_API_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);
const wsUrl = `${apiUrl.replace(/^http/, "ws")}/calls/ws`;
const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
const password = `CallTest-${suffix}-Aa1!`;

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
    throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined;
  }
  return response.json();
}

async function createUser(label) {
  const username = `calltest_${label}_${suffix}`;
  await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      nickname: `Call Test ${label}`,
      username,
      password,
    }),
  });
  const body = new URLSearchParams({ username, password });
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`login ${label}: ${response.status}`);
  const { access_token: token } = await response.json();
  const profile = await request("/users/me", {}, token);
  return { token, profile };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, ["bearer", token]);
    const queue = [];
    const waiters = [];
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "call.error") {
        const error = new Error(`Signaling error ${message.code}: ${message.detail}`);
        waiters.splice(0).forEach(({ reject, timer }) => {
          clearTimeout(timer);
          reject(error);
        });
        queue.push(message);
        return;
      }
      const waiterIndex = waiters.findIndex(({ type }) => type === message.type);
      if (waiterIndex >= 0) {
        const [{ resolve: resolveWaiter, timer }] = waiters.splice(waiterIndex, 1);
        clearTimeout(timer);
        resolveWaiter(message);
      } else {
        queue.push(message);
      }
    });
    socket.once("error", reject);
    socket.once("open", () => {
      resolve({
        socket,
        wait(type, timeout = 10_000) {
          const errorMessage = queue.find((message) => message.type === "call.error");
          if (errorMessage) {
            return Promise.reject(
              new Error(
                `Signaling error ${errorMessage.code}: ${errorMessage.detail}`,
              ),
            );
          }
          const queuedIndex = queue.findIndex((message) => message.type === type);
          if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]);
          return new Promise((resolveWaiter, rejectWaiter) => {
            const waiter = {
              type,
              resolve: resolveWaiter,
              reject: rejectWaiter,
              timer: null,
            };
            waiter.timer = setTimeout(() => {
              const index = waiters.indexOf(waiter);
              if (index >= 0) waiters.splice(index, 1);
              rejectWaiter(new Error(`Timed out waiting for ${type}`));
            }, timeout);
            waiters.push(waiter);
          });
        },
        assertNoError() {
          const errorMessage = queue.find((message) => message.type === "call.error");
          if (errorMessage) {
            throw new Error(
              `Signaling error ${errorMessage.code}: ${errorMessage.detail}`,
            );
          }
        },
      });
    });
  });
}

let first;
let second;
let firstSocket;
let secondSocket;
try {
  [first, second] = await Promise.all([createUser("a"), createUser("b")]);
  const group = await request(
    "/conversations/group",
    {
      method: "POST",
      body: JSON.stringify({
        name: `Call Test Group ${suffix}`,
        description: "Temporary group membership check",
      }),
    },
    first.token,
  );
  const memberParams = new URLSearchParams({
    users_ids: String(second.profile.id),
  });
  await request(
    `/conversations/${group.id}/members?${memberParams.toString()}`,
    { method: "POST" },
    first.token,
  );
  const conversationsAfterMemberAdd = await request(
    "/users/conversations",
    {},
    first.token,
  );
  const updatedGroup = conversationsAfterMemberAdd.find(
    (conversation) => conversation.id === group.id,
  );
  if (
    !updatedGroup?.members.some(
      (member) => member.user_id === second.profile.id,
    )
  ) {
    throw new Error("Added group member is missing from the conversation");
  }
  const creatorMembership = updatedGroup.members.find(
    (member) => member.user_id === first.profile.id,
  );
  if (creatorMembership?.user_role !== "creator") {
    throw new Error("Current user's creator membership is missing");
  }
  const conversation = await request(
    `/conversations/chat?recipient_id=${second.profile.id}`,
    { method: "POST" },
    first.token,
  );
  const bulkMessages = await Promise.all(
    ["first", "second"].map((label) =>
      request(
        `/conversations/${conversation.id}/text`,
        {
          method: "POST",
          body: JSON.stringify({
            content: `Bulk delete ${label} ${suffix}`,
            client_message_id: crypto.randomUUID(),
          }),
        },
        first.token,
      ),
    ),
  );
  const deleteParams = new URLSearchParams();
  bulkMessages.forEach((message) =>
    deleteParams.append("messages_ids", String(message.id)),
  );
  await request(
    `/messages?${deleteParams.toString()}`,
    { method: "DELETE" },
    first.token,
  );
  const messagesAfterBulkDelete = await request(
    `/conversations/${conversation.id}/messages?limit=20`,
    {},
    first.token,
  );
  if (
    bulkMessages.some((deleted) =>
      messagesAfterBulkDelete.some((message) => message.id === deleted.id),
    )
  ) {
    throw new Error("Bulk message deletion did not remove every message");
  }
  const ice = await request("/calls/ice-servers", {}, first.token);
  if (!ice.ice_servers.some((server) => server.username && server.credential)) {
    throw new Error("Authenticated TURN server is missing from ICE configuration");
  }

  [firstSocket, secondSocket] = await Promise.all([
    connect(first.token),
    connect(second.token),
  ]);

  firstSocket.socket.send(
    JSON.stringify({
      type: "call.group_start",
      conversation_id: group.id,
      media: "video",
    }),
  );
  const [groupStarted, groupIncoming] = await Promise.all([
    firstSocket.wait("call.group_started"),
    secondSocket.wait("call.group_incoming"),
  ]);
  if (groupStarted.call_id !== groupIncoming.call_id) {
    throw new Error("Group call IDs do not match");
  }
  secondSocket.socket.send(
    JSON.stringify({
      type: "call.group_join",
      call_id: groupStarted.call_id,
    }),
  );
  const [groupJoined, peerJoined] = await Promise.all([
    secondSocket.wait("call.group_joined"),
    firstSocket.wait("call.group_peer_joined"),
  ]);
  if (
    !groupJoined.participant_ids.includes(first.profile.id) ||
    peerJoined.user_id !== second.profile.id
  ) {
    throw new Error("Group participant synchronization failed");
  }
  secondSocket.socket.send(
    JSON.stringify({
      type: "call.group_offer",
      call_id: groupStarted.call_id,
      target_user_id: first.profile.id,
      offer: { type: "offer", sdp: "v=0\r\ns=Group smoke offer\r\n" },
    }),
  );
  const groupOffer = await firstSocket.wait("call.group_offer");
  if (groupOffer.from_user_id !== second.profile.id) {
    throw new Error("Group offer was not relayed from the joining peer");
  }
  firstSocket.socket.send(
    JSON.stringify({
      type: "call.group_answer",
      call_id: groupStarted.call_id,
      target_user_id: second.profile.id,
      answer: { type: "answer", sdp: "v=0\r\ns=Group smoke answer\r\n" },
    }),
  );
  await secondSocket.wait("call.group_answer");
  firstSocket.socket.send(
    JSON.stringify({
      type: "call.group_media_state",
      call_id: groupStarted.call_id,
      screen_sharing: true,
      screen_audio: true,
    }),
  );
  const groupMedia = await secondSocket.wait("call.group_media_state");
  if (
    groupMedia.from_user_id !== first.profile.id ||
    !groupMedia.screen_sharing ||
    !groupMedia.screen_audio
  ) {
    throw new Error("Group screen-sharing state was not relayed");
  }
  secondSocket.socket.send(
    JSON.stringify({
      type: "call.group_leave",
      call_id: groupStarted.call_id,
    }),
  );
  await Promise.all([
    secondSocket.wait("call.group_left"),
    firstSocket.wait("call.group_peer_left"),
  ]);
  firstSocket.socket.send(
    JSON.stringify({
      type: "call.group_leave",
      call_id: groupStarted.call_id,
    }),
  );
  await firstSocket.wait("call.group_left");

  firstSocket.socket.send(
    JSON.stringify({
      type: "call.start",
      conversation_id: conversation.id,
      media: "video",
      offer: { type: "offer", sdp: "v=0\r\ns=ChatWave smoke offer\r\n" },
    }),
  );
  const [started, incoming] = await Promise.all([
    firstSocket.wait("call.started"),
    secondSocket.wait("call.incoming"),
  ]);
  if (started.call_id !== incoming.call_id) throw new Error("Call IDs do not match");

  secondSocket.socket.send(
    JSON.stringify({
      type: "call.accept",
      call_id: started.call_id,
      answer: { type: "answer", sdp: "v=0\r\ns=ChatWave smoke answer\r\n" },
    }),
  );
  await firstSocket.wait("call.accepted");

  const candidate = {
    candidate: "candidate:1 1 UDP 2122252543 192.0.2.1 50000 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0,
    usernameFragment: "smoke",
  };
  firstSocket.socket.send(
    JSON.stringify({ type: "call.candidate", call_id: started.call_id, candidate }),
  );
  await secondSocket.wait("call.candidate");
  secondSocket.socket.send(
    JSON.stringify({ type: "call.candidate", call_id: started.call_id, candidate }),
  );
  await firstSocket.wait("call.candidate");

  firstSocket.socket.send(
    JSON.stringify({ type: "call.heartbeat", call_id: started.call_id }),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  firstSocket.assertNoError();

  firstSocket.socket.send(
    JSON.stringify({
      type: "call.media_state",
      call_id: started.call_id,
      screen_sharing: true,
      screen_audio: true,
    }),
  );
  const mediaState = await secondSocket.wait("call.media_state");
  if (mediaState.screen_sharing !== true) {
    throw new Error("Screen sharing state was not relayed");
  }
  if (mediaState.screen_audio !== true) {
    throw new Error("Screen audio state was not relayed");
  }

  await request(
    `/calls/${started.call_id}/disconnect`,
    { method: "POST" },
    first.token,
  );
  await secondSocket.wait("call.end");
  const history = await request(
    `/conversations/${conversation.id}/messages?limit=20`,
    {},
    first.token,
  );
  if (
    !history.some(
      (message) =>
        message.content?.startsWith("__chatwave_call__:") &&
        message.content.includes(`"call_id":${started.call_id}`),
    )
  ) {
    throw new Error("Finished call was not recorded in message history");
  }
  console.log(
    "Group members, call signaling, history, bulk deletion and ICE configuration: OK",
  );
} finally {
  firstSocket?.socket.close();
  secondSocket?.socket.close();
  await Promise.allSettled(
    [first, second]
      .filter(Boolean)
      .map((user) => request("/users/me", { method: "DELETE" }, user.token)),
  );
}
