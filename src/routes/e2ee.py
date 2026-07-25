import hashlib
import re
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Response

from dependencies import verify_token
from repository import (
    acknowledge_to_device_events,
    claim_e2ee_one_time_keys,
    insert_to_device_events,
    revoke_e2ee_device,
    select_e2ee_device_keys,
    select_e2ee_devices,
    select_one_time_key_counts,
    select_reachable_user_ids,
    select_shared_user_ids,
    select_to_device_events,
    upload_e2ee_keys,
    upsert_e2ee_key_backup,
    select_e2ee_key_backup,
)
from schemas import (
    DeviceId,
    DeviceSecret,
    EventType,
    KeysClaim,
    KeysQuery,
    KeysUpload,
    KeyBackup,
    ToDeviceMessages,
    TransactionId,
)


e2ee_router = APIRouter(tags=["E2EE"], prefix="/e2ee")
MATRIX_USER_ID_PATTERN = re.compile(r"^@user-([1-9][0-9]*):chatwave\.local$")


def matrix_user_id(user_id: int) -> str:
    return f"@user-{user_id}:chatwave.local"


def device_secret_hash(device_secret: str) -> str:
    return hashlib.sha256(device_secret.encode()).hexdigest()


def parse_matrix_user_id(value: str) -> int:
    match = MATRIX_USER_ID_PATTERN.fullmatch(value)
    if match is None:
        raise HTTPException(status_code=400, detail="Invalid ChatWave crypto user id")
    parsed = int(match.group(1))
    if parsed > 2_147_483_647:
        raise HTTPException(status_code=400, detail="Invalid ChatWave crypto user id")
    return parsed


async def require_reachable_users(
    current_user_id: int,
    crypto_user_ids: list[str],
) -> dict[str, int]:
    parsed = {
        crypto_user_id: parse_matrix_user_id(crypto_user_id)
        for crypto_user_id in crypto_user_ids
    }
    reachable = await select_reachable_user_ids(
        current_user_id,
        parsed.values(),
    )
    if reachable != set(parsed.values()):
        raise HTTPException(status_code=403, detail="E2EE key access denied")
    return parsed


def validate_own_device_keys(
    current_user_id: int,
    device_id: str,
    device_keys: dict | None,
) -> None:
    if device_keys is None:
        return
    if (
        device_keys.get("user_id") != matrix_user_id(current_user_id)
        or device_keys.get("device_id") != device_id
    ):
        raise HTTPException(
            status_code=400,
            detail="Device key identity does not match the authenticated device",
        )
    keys = device_keys.get("keys")
    algorithms = device_keys.get("algorithms")
    signatures = device_keys.get("signatures")
    own_signatures = (
        signatures.get(matrix_user_id(current_user_id))
        if isinstance(signatures, dict)
        else None
    )
    if (
        not isinstance(keys, dict)
        or not isinstance(algorithms, list)
        or not algorithms
        or not keys.get(f"ed25519:{device_id}")
        or not keys.get(f"curve25519:{device_id}")
        or not isinstance(own_signatures, dict)
        or not own_signatures.get(f"ed25519:{device_id}")
    ):
        raise HTTPException(status_code=400, detail="Incomplete device keys")


@e2ee_router.post("/keys/upload")
async def upload_keys(
    payload: KeysUpload,
    current_user_id: Annotated[int, Depends(verify_token)],
    device_id: Annotated[DeviceId, Header(alias="X-ChatWave-Device-ID")],
    device_secret: Annotated[
        DeviceSecret,
        Header(alias="X-ChatWave-Device-Secret"),
    ],
):
    validate_own_device_keys(current_user_id, device_id, payload.device_keys)
    try:
        counts = await upload_e2ee_keys(
            user_id=current_user_id,
            device_id=device_id,
            access_secret_hash=device_secret_hash(device_secret),
            device_keys=payload.device_keys,
            one_time_keys=payload.one_time_keys,
            fallback_keys=payload.fallback_keys,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"one_time_key_counts": counts}


@e2ee_router.post("/keys/query")
async def query_keys(
    payload: KeysQuery,
    current_user_id: Annotated[int, Depends(verify_token)],
):
    parsed = await require_reachable_users(
        current_user_id,
        list(payload.device_keys),
    )
    requested = {
        parsed[crypto_user_id]: device_ids
        for crypto_user_id, device_ids in payload.device_keys.items()
    }
    keys = await select_e2ee_device_keys(requested)
    return {
        "device_keys": {
            matrix_user_id(user_id): devices
            for user_id, devices in keys.items()
        },
        "failures": {},
    }


@e2ee_router.post("/keys/claim")
async def claim_keys(
    payload: KeysClaim,
    current_user_id: Annotated[int, Depends(verify_token)],
):
    parsed = await require_reachable_users(
        current_user_id,
        list(payload.one_time_keys),
    )
    requested = {
        parsed[crypto_user_id]: device_map
        for crypto_user_id, device_map in payload.one_time_keys.items()
    }
    keys = await claim_e2ee_one_time_keys(requested)
    return {
        "one_time_keys": {
            matrix_user_id(user_id): devices
            for user_id, devices in keys.items()
        },
        "failures": {},
    }


@e2ee_router.put("/sendToDevice/{event_type}/{transaction_id}")
async def send_to_device(
    payload: ToDeviceMessages,
    current_user_id: Annotated[int, Depends(verify_token)],
    event_type: Annotated[EventType, Path()],
    transaction_id: Annotated[TransactionId, Path()],
):
    parsed = await require_reachable_users(
        current_user_id,
        list(payload.messages),
    )
    messages = {
        parsed[crypto_user_id]: device_map
        for crypto_user_id, device_map in payload.messages.items()
    }
    await insert_to_device_events(
        sender_user_id=current_user_id,
        event_type=event_type,
        transaction_id=transaction_id,
        messages=messages,
    )
    return {}


@e2ee_router.get("/sync")
async def sync_to_device(
    current_user_id: Annotated[int, Depends(verify_token)],
    device_id: Annotated[DeviceId, Header(alias="X-ChatWave-Device-ID")],
    device_secret: Annotated[
        DeviceSecret,
        Header(alias="X-ChatWave-Device-Secret"),
    ],
    since: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    try:
        events, next_batch = await select_to_device_events(
            user_id=current_user_id,
            device_id=device_id,
            access_secret_hash=device_secret_hash(device_secret),
            since=since,
            limit=limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    changed_user_ids = (
        await select_shared_user_ids(current_user_id)
        if since == 0
        else {event.sender_user_id for event in events}
    )
    one_time_key_counts = await select_one_time_key_counts(
        current_user_id,
        device_id,
    )
    return {
        "next_batch": str(next_batch),
        "to_device": {
            "events": [
                {
                    "sender": matrix_user_id(event.sender_user_id),
                    "type": event.event_type,
                    "content": event.content,
                }
                for event in events
            ]
        },
        # Initial sync tracks the authorized contact set. Later syncs mark
        # only senders of new key events, avoiding repeated global key queries.
        "device_lists": {
            "changed": [
                matrix_user_id(user_id)
                for user_id in sorted(changed_user_ids)
            ],
            "left": [],
        },
        "device_one_time_keys_count": one_time_key_counts,
        "device_unused_fallback_key_types": [],
    }


@e2ee_router.post("/sync/{up_to}/ack", status_code=204)
async def acknowledge_sync(
    current_user_id: Annotated[int, Depends(verify_token)],
    device_id: Annotated[DeviceId, Header(alias="X-ChatWave-Device-ID")],
    device_secret: Annotated[
        DeviceSecret,
        Header(alias="X-ChatWave-Device-Secret"),
    ],
    up_to: Annotated[int, Path(ge=0)],
):
    await acknowledge_to_device_events(
        user_id=current_user_id,
        device_id=device_id,
        access_secret_hash=device_secret_hash(device_secret),
        up_to=up_to,
    )
    return Response(status_code=204)


@e2ee_router.get("/devices")
async def list_devices(
    current_user_id: Annotated[int, Depends(verify_token)],
):
    devices = await select_e2ee_devices(current_user_id)
    return {
        "devices": [
            {
                "device_id": device.device_id,
                "display_name": device.display_name,
                "created_at": device.created_at,
                "last_seen_at": device.last_seen_at,
                "revoked_at": device.revoked_at,
            }
            for device in devices
        ]
    }


@e2ee_router.delete("/devices/{device_id}", status_code=204)
async def revoke_device(
    current_user_id: Annotated[int, Depends(verify_token)],
    device_id: Annotated[DeviceId, Path()],
):
    revoked = await revoke_e2ee_device(current_user_id, device_id)
    if not revoked:
        raise HTTPException(status_code=404, detail="E2EE device not found")
    return Response(status_code=204)


@e2ee_router.put("/backup", status_code=204)
async def save_key_backup(
    payload: KeyBackup,
    current_user_id: Annotated[int, Depends(verify_token)],
):
    await upsert_e2ee_key_backup(
        user_id=current_user_id,
        version=payload.version,
        encrypted_data=payload.encrypted_data,
    )
    return Response(status_code=204)


@e2ee_router.get("/backup")
async def get_key_backup(
    current_user_id: Annotated[int, Depends(verify_token)],
):
    backup = await select_e2ee_key_backup(current_user_id)
    if backup is None:
        raise HTTPException(status_code=404, detail="E2EE key backup not found")
    return {
        "version": backup.version,
        "encrypted_data": backup.encrypted_data,
        "updated_at": backup.updated_at,
    }
