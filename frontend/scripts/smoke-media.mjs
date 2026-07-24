import { readFile } from "node:fs/promises";

const apiUrl = (process.env.CHATWAVE_API_URL ?? "http://chatwave:8000").replace(
  /\/$/,
  "",
);
const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
const username = `media_${suffix}`;
const password = `Media-${suffix}-Aa1!`;

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

function silentWav() {
  const sampleRate = 8_000;
  const samples = sampleRate / 4;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

let token;
try {
  await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      nickname: "Media Smoke",
      username,
      password,
    }),
  });
  const loginResponse = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
  });
  if (!loginResponse.ok) throw new Error(`login: ${loginResponse.status}`);
  token = (await loginResponse.json()).access_token;

  const group = await request(
    "/conversations/group",
    {
      method: "POST",
      body: JSON.stringify({ name: `Media ${suffix}`, description: null }),
    },
    token,
  );

  const jpeg = await readFile(
    new URL("../../tests/media/users_avatars/valid.jpg", import.meta.url),
  );
  const imageBody = new FormData();
  imageBody.append(
    "file",
    new Blob([jpeg], { type: "image/jpeg" }),
    "preview.jpg",
  );
  const imageMessage = await request(
    `/conversations/${group.id}/media?is_voice_message=false`,
    { method: "POST", body: imageBody },
    token,
  );
  if (
    imageMessage.type !== "image" ||
    imageMessage.file_content_type !== "image/jpeg"
  ) {
    throw new Error("Image message metadata is invalid");
  }
  const imageResponse = await fetch(
    `${apiUrl}/messages/${imageMessage.id}/media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (
    !imageResponse.ok ||
    imageResponse.headers.get("content-type") !== "image/jpeg" ||
    (await imageResponse.arrayBuffer()).byteLength !== jpeg.length
  ) {
    throw new Error("Inline image response is invalid");
  }

  const voiceBody = new FormData();
  const wav = silentWav();
  voiceBody.append(
    "file",
    new Blob([wav], { type: "audio/wav" }),
    "voice.wav",
  );
  const voiceMessage = await request(
    `/conversations/${group.id}/media?is_voice_message=true`,
    { method: "POST", body: voiceBody },
    token,
  );
  if (voiceMessage.type !== "voice") {
    throw new Error("Voice message was not classified as voice");
  }
  const rangeResponse = await fetch(
    `${apiUrl}/messages/${voiceMessage.id}/media`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Range: "bytes=0-31",
      },
    },
  );
  if (
    rangeResponse.status !== 206 ||
    !rangeResponse.headers.get("content-range")?.startsWith("bytes 0-31/")
  ) {
    throw new Error("Authorized media Range response is invalid");
  }
  console.log("Inline image, voice playback and authorized byte ranges: OK");
} finally {
  if (token) {
    await request("/users/me", { method: "DELETE" }, token).catch(() => undefined);
  }
}
