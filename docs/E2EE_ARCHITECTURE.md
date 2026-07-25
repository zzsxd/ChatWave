# ChatWave E2EE architecture

## Status

The device-key transport, encrypted text timeline events, local search over
loaded plaintext, and recovery-key-protected room-key export are implemented.
Legacy plaintext messages and unencrypted media remain supported during the
migration. The UI must never label those legacy items as end-to-end encrypted.

Encrypted media, a persistent encrypted search index, cross-signing, and
QR/SAS device verification are still pending. This mixed-mode version must not
be presented as complete messenger-wide E2EE.

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
- device: a random, client-generated 128-bit uppercase base64url identifier;
- room: `!conversation-{conversation_id}:chatwave.local`.

Each device also has an independent 256-bit transport secret. The browser
sends it only on device-bound upload/sync/ack requests; the server stores only
its SHA-256 digest. An account bearer token alone therefore cannot consume
another device's queued key events by spoofing its public device ID.

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
| `PUT /e2ee/sendToDevice/{event_type}/{txn_id}` | Queue opaque Olm events |
| `GET /e2ee/sync` | Fetch to-device events, device changes, and key counts |
| `POST /e2ee/sync/{up_to}/ack` | Acknowledge queued to-device events |
| `DELETE /e2ee/devices/{device_id}` | Revoke a device |
| `PUT /e2ee/backup` | Store an encrypted Megolm session export |
| `GET /e2ee/backup` | Fetch an encrypted Megolm session export |
| `POST /conversations/{id}/encrypted` | Store an opaque timeline event |

Requests and responses follow the corresponding Matrix key API JSON shapes so
they can be passed to `OlmMachine.markRequestAsSent` without transforming
cryptographic data.

## Message envelope

Legacy plaintext stays in `messages.content`. Encrypted events always keep that
column null and use the separate `encryption_algorithm` and
`encrypted_content` columns:

```json
{
  "algorithm": "m.megolm.v1.aes-sha2",
  "ciphertext": "...",
  "device_id": "...",
  "sender_key": "...",
  "session_id": "..."
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

The current encrypted-message search is local over messages already decrypted
and loaded in the active chat. The target implementation is:

1. decrypt timeline events on the device;
2. normalize and tokenize plaintext;
3. store an encrypted local index in IndexedDB;
4. query the local index and fetch missing timeline pages as needed.

The existing server `/messages/search` route returns legacy plaintext only;
encrypted rows have null plaintext and therefore cannot match.

## New devices and recovery

A new device can recover old Megolm room keys by entering the recovery key in
profile security settings. The client exports room keys, encrypts the export
locally with 200,000 passphrase-KDF rounds, and uploads only the encrypted
blob. Live room keys are delivered to newly registered devices through Olm.

The stronger target flow starts a new device unverified and trusts it only
after one of:

- QR/SAS verification with an existing verified device, followed by encrypted
  secret and room-key transfer;
- recovery using an encrypted key backup protected by a user-held recovery key.

The account password is not the recovery key. Losing all existing devices and
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
