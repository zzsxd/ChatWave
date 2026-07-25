# ChatWave E2EE architecture

## Status

This document defines the migration target. Plaintext messages remain legacy
until the client and key-service paths below are complete. The UI must never
label a legacy message as end-to-end encrypted.

## Cryptographic core

ChatWave uses the maintained Rust `matrix-sdk-crypto` state machine through its
official WebAssembly bindings. It provides:

- Olm sessions for device-to-device key delivery;
- Megolm ratchets for encrypted conversation events;
- Ed25519 device signing and Curve25519 identity keys;
- one-time and fallback prekeys;
- IndexedDB-backed client key storage;
- cross-signing, device verification, and encrypted room-key backup.

ChatWave does not implement cryptographic primitives or ratchets itself.

## Identifiers

The crypto state machine receives deterministic Matrix-shaped identifiers that
are internal to ChatWave and are never exposed as account handles:

- user: `@user-{user_id}:chatwave.local`;
- device: a random, client-generated 128-bit uppercase base32 identifier;
- room: `!conversation-{conversation_id}:chatwave.local`.

## Server responsibilities

The server is an untrusted transport for message confidentiality. It may:

- authenticate accounts and authorize conversation membership;
- store signed public device keys and one-time prekeys;
- atomically claim one-time prekeys;
- queue opaque to-device events;
- store opaque encrypted timeline events;
- store encrypted room-key backups;
- enforce quotas, ordering, deletion, and membership.

It must never receive message plaintext, media keys, private identity keys,
cross-signing private keys, recovery keys, or a searchable plaintext index.

## Required transport endpoints

All endpoints require the existing bearer authentication.

| Endpoint | Purpose |
| --- | --- |
| `POST /e2ee/keys/upload` | Upload signed device, one-time, and fallback keys |
| `POST /e2ee/keys/query` | Fetch current signed device keys |
| `POST /e2ee/keys/claim` | Atomically claim one-time keys |
| `PUT /e2ee/to-device/{event_type}/{txn_id}` | Queue opaque Olm events |
| `GET /e2ee/sync` | Fetch and acknowledge to-device events and key counts |
| `DELETE /e2ee/devices/{device_id}` | Revoke a device |
| `PUT /e2ee/backup/{version}` | Store encrypted Megolm session backups |
| `GET /e2ee/backup/{version}` | Restore encrypted Megolm session backups |

Requests and responses follow the corresponding Matrix key API JSON shapes so
they can be passed to `OlmMachine.markRequestAsSent` without transforming
cryptographic data.

## Message envelope

The `messages.content` column temporarily carries either legacy plaintext or a
versioned JSON envelope:

```json
{
  "v": 1,
  "algorithm": "m.megolm.v1.aes-sha2",
  "ciphertext": {}
}
```

The authenticated sender, conversation ID, server message ID, timestamps,
receipts, and deletion state remain server-visible metadata. Text, captions,
reply bodies, file names, reactions intended to be private, and media keys are
inside the encrypted event.

## Media

The client generates a random key per attachment, encrypts bytes before upload,
and places the key, original MIME type, file name, and hashes inside the
encrypted message event. The server stores `application/octet-stream` and
enforces only ciphertext-size quotas. Thumbnails are generated and encrypted on
the client.

## Search

Search is local:

1. decrypt timeline events on the device;
2. normalize and tokenize plaintext;
3. store an encrypted local index in IndexedDB;
4. query the local index and fetch missing timeline pages as needed.

The existing server `/messages/search` route remains available only for legacy
rooms during migration and must reject E2EE-only conversations.

## New devices and recovery

A new device starts unverified and cannot receive room keys until one of:

- QR/SAS verification with an existing verified device, followed by encrypted
  secret and room-key transfer;
- recovery using an encrypted key backup protected by a user-held recovery key.

The account password is not the recovery key. Losing all verified devices and
the recovery key means losing access to old encrypted history.

## Membership changes

Adding or removing a group member invalidates the outbound Megolm session.
Removed devices never receive the replacement session. Revocation cannot erase
plaintext that a former member legitimately decrypted in the past.

## Migration

1. Register device keys without changing message behavior.
2. Enable E2EE for newly-created opt-in test conversations.
3. Add local search, encrypted media, device verification, and backup recovery.
4. Make E2EE the default for new conversations.
5. Offer explicit client-driven migration of legacy history.
6. Disable plaintext message creation after the migration window.

