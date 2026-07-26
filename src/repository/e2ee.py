from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import and_, delete, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import aliased

from database import session
from models import (
    ConversationMembers,
    E2EEDevices,
    E2EEKeyBackups,
    E2EEOneTimeKeys,
    E2EEToDeviceEvents,
)


@dataclass(frozen=True, slots=True)
class ToDeviceEvent:
    id: int
    sender_user_id: int
    event_type: str
    content: dict


async def select_reachable_user_ids(
    user_id: int,
    requested_user_ids: Iterable[int],
) -> set[int]:
    requested = set(requested_user_ids)
    if not requested:
        return set()

    requester_memberships = aliased(ConversationMembers)
    target_memberships = aliased(ConversationMembers)
    async with session() as cursor:
        result = await cursor.execute(
            select(target_memberships.user_id)
            .join(
                requester_memberships,
                requester_memberships.conversation_id
                == target_memberships.conversation_id,
            )
            .where(
                requester_memberships.user_id == user_id,
                target_memberships.user_id.in_(requested),
            )
            .distinct()
        )
        reachable = set(result.scalars().all())
    if user_id in requested:
        reachable.add(user_id)
    return reachable


async def select_shared_user_ids(user_id: int) -> set[int]:
    requester_memberships = aliased(ConversationMembers)
    target_memberships = aliased(ConversationMembers)
    async with session() as cursor:
        result = await cursor.execute(
            select(target_memberships.user_id)
            .join(
                requester_memberships,
                requester_memberships.conversation_id
                == target_memberships.conversation_id,
            )
            .where(requester_memberships.user_id == user_id)
            .distinct()
        )
        shared = set(result.scalars().all())
    shared.add(user_id)
    return shared


def _identity_keys(device_keys: dict, device_id: str) -> tuple[object, object]:
    keys = device_keys.get("keys")
    if not isinstance(keys, dict):
        return None, None
    return (
        keys.get(f"ed25519:{device_id}"),
        keys.get(f"curve25519:{device_id}"),
    )


async def upload_e2ee_keys(
    user_id: int,
    device_id: str,
    access_secret_hash: str,
    device_keys: dict | None,
    one_time_keys: dict[str, dict],
    fallback_keys: dict[str, dict],
) -> dict[str, int]:
    async with session() as cursor:
        if device_keys is not None:
            existing_result = await cursor.execute(
                select(
                    E2EEDevices.device_keys,
                    E2EEDevices.access_secret_hash,
                ).where(
                    E2EEDevices.user_id == user_id,
                    E2EEDevices.device_id == device_id,
                )
            )
            existing = existing_result.one_or_none()
            existing_keys = existing.device_keys if existing is not None else None
            if (
                existing is not None
                and existing.access_secret_hash != access_secret_hash
            ):
                raise ValueError("E2EE device authentication failed")
            if (
                existing_keys is not None
                and _identity_keys(existing_keys, device_id)
                != _identity_keys(device_keys, device_id)
            ):
                raise ValueError(
                    "Device identity keys cannot be replaced; revoke this "
                    "device and register a new device id"
                )
            await cursor.execute(
                insert(E2EEDevices)
                .values(
                    user_id=user_id,
                    device_id=device_id,
                    access_secret_hash=access_secret_hash,
                    device_keys=device_keys,
                )
                .on_conflict_do_update(
                    index_elements=[
                        E2EEDevices.user_id,
                        E2EEDevices.device_id,
                    ],
                    set_={
                        "device_keys": device_keys,
                        "updated_at": text("TIMEZONE('utc', now())"),
                        "last_seen_at": text("TIMEZONE('utc', now())"),
                        "revoked_at": None,
                    },
                )
            )
        else:
            device_result = await cursor.execute(
                select(E2EEDevices.user_id).where(
                    E2EEDevices.user_id == user_id,
                    E2EEDevices.device_id == device_id,
                    E2EEDevices.access_secret_hash == access_secret_hash,
                    E2EEDevices.revoked_at.is_(None),
                )
            )
            if device_result.scalar_one_or_none() is None:
                raise ValueError("Device keys must be uploaded first")
            await cursor.execute(
                update(E2EEDevices)
                .where(
                    E2EEDevices.user_id == user_id,
                    E2EEDevices.device_id == device_id,
                )
                .values(last_seen_at=text("TIMEZONE('utc', now())"))
            )

        for key_id, key_data in one_time_keys.items():
            await cursor.execute(
                insert(E2EEOneTimeKeys)
                .values(
                    user_id=user_id,
                    device_id=device_id,
                    key_id=key_id,
                    algorithm=key_id.split(":", 1)[0],
                    key_data=key_data,
                    is_fallback=False,
                )
                .on_conflict_do_nothing()
            )

        for key_id, key_data in fallback_keys.items():
            algorithm = key_id.split(":", 1)[0]
            await cursor.execute(
                delete(E2EEOneTimeKeys).where(
                    E2EEOneTimeKeys.user_id == user_id,
                    E2EEOneTimeKeys.device_id == device_id,
                    E2EEOneTimeKeys.algorithm == algorithm,
                    E2EEOneTimeKeys.is_fallback.is_(True),
                    E2EEOneTimeKeys.key_id != key_id,
                )
            )
            await cursor.execute(
                insert(E2EEOneTimeKeys)
                .values(
                    user_id=user_id,
                    device_id=device_id,
                    key_id=key_id,
                    algorithm=algorithm,
                    key_data=key_data,
                    is_fallback=True,
                )
                .on_conflict_do_update(
                    index_elements=[
                        E2EEOneTimeKeys.user_id,
                        E2EEOneTimeKeys.device_id,
                        E2EEOneTimeKeys.key_id,
                    ],
                    set_={
                        "algorithm": algorithm,
                        "key_data": key_data,
                        "is_fallback": True,
                    },
                )
            )

        result = await cursor.execute(
            select(
                E2EEOneTimeKeys.algorithm,
                func.count(),
            )
            .where(
                E2EEOneTimeKeys.user_id == user_id,
                E2EEOneTimeKeys.device_id == device_id,
                E2EEOneTimeKeys.is_fallback.is_(False),
            )
            .group_by(E2EEOneTimeKeys.algorithm)
        )
        counts = {algorithm: count for algorithm, count in result.all()}
        await cursor.commit()
        return counts


async def select_e2ee_device_keys(
    requested_devices: dict[int, list[str]],
) -> dict[int, dict[str, dict]]:
    if not requested_devices:
        return {}

    filters = []
    for user_id, device_ids in requested_devices.items():
        condition = E2EEDevices.user_id == user_id
        if device_ids:
            condition = and_(
                condition,
                E2EEDevices.device_id.in_(device_ids),
            )
        filters.append(condition)

    async with session() as cursor:
        result = await cursor.execute(
            select(E2EEDevices).where(
                E2EEDevices.revoked_at.is_(None),
                or_(*filters),
            )
        )
        response: dict[int, dict[str, dict]] = {}
        for device in result.scalars().all():
            response.setdefault(device.user_id, {})[
                device.device_id
            ] = device.device_keys
        return response


async def select_one_time_key_counts(
    user_id: int,
    device_id: str,
) -> dict[str, int]:
    async with session() as cursor:
        result = await cursor.execute(
            select(E2EEOneTimeKeys.algorithm, func.count())
            .where(
                E2EEOneTimeKeys.user_id == user_id,
                E2EEOneTimeKeys.device_id == device_id,
                E2EEOneTimeKeys.is_fallback.is_(False),
            )
            .group_by(E2EEOneTimeKeys.algorithm)
        )
        return {algorithm: count for algorithm, count in result.all()}


async def claim_e2ee_one_time_keys(
    requested_keys: dict[int, dict[str, str]],
) -> dict[int, dict[str, dict[str, dict]]]:
    claimed: dict[int, dict[str, dict[str, dict]]] = {}
    async with session() as cursor:
        for user_id, device_map in requested_keys.items():
            for device_id, algorithm in device_map.items():
                result = await cursor.execute(
                    select(E2EEOneTimeKeys)
                    .where(
                        E2EEOneTimeKeys.user_id == user_id,
                        E2EEOneTimeKeys.device_id == device_id,
                        E2EEOneTimeKeys.algorithm == algorithm,
                    )
                    .order_by(
                        E2EEOneTimeKeys.is_fallback.asc(),
                        E2EEOneTimeKeys.created_at.asc(),
                    )
                    .limit(1)
                    .with_for_update(skip_locked=True)
                )
                key = result.scalar_one_or_none()
                if key is None:
                    continue
                claimed.setdefault(user_id, {}).setdefault(
                    device_id,
                    {},
                )[key.key_id] = key.key_data
                if not key.is_fallback:
                    await cursor.delete(key)
        await cursor.commit()
    return claimed


async def insert_to_device_events(
    sender_user_id: int,
    event_type: str,
    transaction_id: str,
    messages: dict[int, dict[str, dict]],
) -> None:
    if not messages:
        return
    async with session() as cursor:
        for recipient_user_id, device_map in messages.items():
            expanded = dict(device_map)
            wildcard_content = expanded.pop("*", None)
            if wildcard_content is not None:
                result = await cursor.execute(
                    select(E2EEDevices.device_id).where(
                        E2EEDevices.user_id == recipient_user_id,
                        E2EEDevices.revoked_at.is_(None),
                    )
                )
                for device_id in result.scalars().all():
                    expanded.setdefault(device_id, wildcard_content)

            if not expanded:
                continue
            result = await cursor.execute(
                select(E2EEDevices.device_id).where(
                    E2EEDevices.user_id == recipient_user_id,
                    E2EEDevices.device_id.in_(expanded),
                    E2EEDevices.revoked_at.is_(None),
                )
            )
            valid_devices = set(result.scalars().all())
            for device_id in valid_devices:
                await cursor.execute(
                    insert(E2EEToDeviceEvents)
                    .values(
                        sender_user_id=sender_user_id,
                        recipient_user_id=recipient_user_id,
                        recipient_device_id=device_id,
                        event_type=event_type,
                        transaction_id=transaction_id,
                        content=expanded[device_id],
                    )
                    .on_conflict_do_nothing(
                        constraint="uq_e2ee_to_device_delivery"
                    )
                )
        await cursor.commit()


async def select_to_device_events(
    user_id: int,
    device_id: str,
    access_secret_hash: str,
    since: int,
    limit: int,
) -> tuple[list[ToDeviceEvent], int]:
    async with session() as cursor:
        result = await cursor.execute(
            select(
                E2EEToDeviceEvents.id,
                E2EEToDeviceEvents.sender_user_id,
                E2EEToDeviceEvents.event_type,
                E2EEToDeviceEvents.content,
            )
            .where(
                E2EEToDeviceEvents.recipient_user_id == user_id,
                E2EEToDeviceEvents.recipient_device_id == device_id,
                E2EEToDeviceEvents.id > since,
            )
            .order_by(E2EEToDeviceEvents.id.asc())
            .limit(limit)
        )
        # Do not return ORM instances across the transaction boundary. The
        # device last-seen update below commits the session and expires them,
        # which otherwise makes /e2ee/sync fail with DetachedInstanceError
        # before the recipient can receive its room key.
        events = [
            ToDeviceEvent(
                id=row.id,
                sender_user_id=row.sender_user_id,
                event_type=row.event_type,
                content=row.content,
            )
            for row in result.all()
        ]
        next_batch = events[-1].id if events else since
        if not events and since == 0:
            # Reserve an empty initial-sync watermark. Returning 0 forever
            # makes the client treat every poll as its first sync, which in
            # turn causes Matrix SDK to query every device key repeatedly.
            # Consuming one sequence value is safe: every future event receives
            # a strictly larger id and therefore cannot be skipped.
            watermark_result = await cursor.execute(
                text(
                    "SELECT nextval("
                    "pg_get_serial_sequence("
                    "'e2ee_to_device_events', 'id'"
                    ")"
                    ")"
                )
            )
            next_batch = watermark_result.scalar_one()
        device_result = await cursor.execute(
            update(E2EEDevices)
            .where(
                E2EEDevices.user_id == user_id,
                E2EEDevices.device_id == device_id,
                E2EEDevices.access_secret_hash == access_secret_hash,
                E2EEDevices.revoked_at.is_(None),
            )
            .values(last_seen_at=text("TIMEZONE('utc', now())"))
            .returning(E2EEDevices.device_id)
        )
        if device_result.scalar_one_or_none() is None:
            raise ValueError("E2EE device is not registered or has been revoked")
        await cursor.commit()
        return events, next_batch


async def acknowledge_to_device_events(
    user_id: int,
    device_id: str,
    access_secret_hash: str,
    up_to: int,
) -> None:
    async with session() as cursor:
        device_result = await cursor.execute(
            select(E2EEDevices.device_id).where(
                E2EEDevices.user_id == user_id,
                E2EEDevices.device_id == device_id,
                E2EEDevices.access_secret_hash == access_secret_hash,
                E2EEDevices.revoked_at.is_(None),
            )
        )
        if device_result.scalar_one_or_none() is None:
            raise ValueError("E2EE device authentication failed")
        await cursor.execute(
            delete(E2EEToDeviceEvents).where(
                E2EEToDeviceEvents.recipient_user_id == user_id,
                E2EEToDeviceEvents.recipient_device_id == device_id,
                E2EEToDeviceEvents.id <= up_to,
            )
        )
        await cursor.commit()


async def revoke_e2ee_device(user_id: int, device_id: str) -> bool:
    async with session() as cursor:
        result = await cursor.execute(
            update(E2EEDevices)
            .where(
                E2EEDevices.user_id == user_id,
                E2EEDevices.device_id == device_id,
                E2EEDevices.revoked_at.is_(None),
            )
            .values(
                revoked_at=text("TIMEZONE('utc', now())"),
                updated_at=text("TIMEZONE('utc', now())"),
            )
            .returning(E2EEDevices.device_id)
        )
        revoked = result.scalar_one_or_none() is not None
        await cursor.commit()
        return revoked


async def select_e2ee_devices(user_id: int) -> list[E2EEDevices]:
    async with session() as cursor:
        result = await cursor.execute(
            select(E2EEDevices)
            .where(E2EEDevices.user_id == user_id)
            .order_by(E2EEDevices.created_at.asc())
        )
        return list(result.scalars().all())


async def upsert_e2ee_key_backup(
    user_id: int,
    version: int,
    encrypted_data: str,
) -> None:
    async with session() as cursor:
        await cursor.execute(
            insert(E2EEKeyBackups)
            .values(
                user_id=user_id,
                version=version,
                encrypted_data=encrypted_data,
            )
            .on_conflict_do_update(
                index_elements=[E2EEKeyBackups.user_id],
                set_={
                    "version": version,
                    "encrypted_data": encrypted_data,
                    "updated_at": text("TIMEZONE('utc', now())"),
                },
            )
        )
        await cursor.commit()


async def select_e2ee_key_backup(user_id: int) -> E2EEKeyBackups | None:
    async with session() as cursor:
        result = await cursor.execute(
            select(E2EEKeyBackups).where(E2EEKeyBackups.user_id == user_id)
        )
        return result.scalar_one_or_none()
