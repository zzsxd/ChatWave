"use client";

import {
  DeviceId,
  OlmMachine,
  RoomId,
  UserId,
  initAsync,
} from "@matrix-org/matrix-sdk-crypto-wasm";
import matrixCryptoWasmUrl from "../../node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm?url";

const DEVICE_ID_KEY = "chatwave_e2ee_device_id";
const STORE_SECRET_KEY = "chatwave_e2ee_store_secret";
const DEVICE_SECRET_KEY = "chatwave_e2ee_device_secret";
const WASM_CACHE_REVISION = "20260727-3";

let wasmReady: Promise<void> | null = null;
let activeMachine:
  | {
      accountId: number;
      machine: OlmMachine;
      deviceId: string;
      deviceSecret: string;
    }
  | null = null;

function randomBase64Url(bytes: number) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function persistentSecret(key: string, bytes: number) {
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = randomBase64Url(bytes);
  localStorage.setItem(key, created);
  return created;
}

export function cryptoUserId(accountId: number) {
  return `@user-${accountId}:chatwave.local`;
}

export function cryptoRoomId(conversationId: number) {
  return new RoomId(`!conversation-${conversationId}:chatwave.local`);
}

export async function getCryptoMachine(accountId: number) {
  if (activeMachine?.accountId === accountId) return activeMachine;
  if (activeMachine) {
    activeMachine.machine.close();
    activeMachine = null;
  }

  if (!wasmReady) {
    wasmReady = initAsync(
      `${matrixCryptoWasmUrl}?v=${WASM_CACHE_REVISION}`,
    ).catch((error) => {
      // A transient network/cache error must not poison every later send and
      // retry attempt for the lifetime of the tab.
      wasmReady = null;
      throw error;
    });
  }
  await wasmReady;

  const deviceId = persistentSecret(DEVICE_ID_KEY, 16).toUpperCase();
  const storeSecret = persistentSecret(STORE_SECRET_KEY, 32);
  const deviceSecret = persistentSecret(DEVICE_SECRET_KEY, 32);
  const machine = await OlmMachine.initialize(
    new UserId(cryptoUserId(accountId)),
    new DeviceId(deviceId),
    `chatwave-e2ee-${accountId}-${deviceId}`,
    storeSecret,
  );
  activeMachine = { accountId, machine, deviceId, deviceSecret };
  return activeMachine;
}

export function closeCryptoMachine() {
  activeMachine?.machine.close();
  activeMachine = null;
}
