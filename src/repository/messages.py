from sqlalchemy import select, update, insert, and_, delete, text, func
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.orm import selectinload
from uuid import NAMESPACE_URL, uuid5

from models import (
    ConversationMembers,
    MessageReceipts,
    Messages,
    UnreadMessages,
    PinnedMessages,
)
from database import session
from schemas import (
    CreateEncryptedMessageDB,
    CreateMediaMessageDB,
    CreateTextMessageDB,
)
from utilities import (
    MessagesStatus,
    MessagesTypes,
    StorageQuotaExceeded,
    UserNotInConversation,
    generic_settings,
)


async def is_message_exists(message_id: int) -> bool:
    async with session() as cursor:
        query = (
            select(Messages.id)
            .filter_by(id=message_id)
        )
        result = await cursor.execute(query)
        if result.first():
            return True

        return False


async def update_message_status(message_id: int, status: MessagesStatus) -> None:
    async with session() as cursor:
        query = (
            update(Messages)
            .filter_by(id=message_id)
            .values(
                status=status,
                updated_at=text("updated_at"),
            )
        )
        await cursor.execute(query)
        await cursor.commit()


async def _insert_notifications(
    cursor,
    sender_id: int,
    conversation_id: int,
    message_id: int,
) -> None:
    result = await cursor.execute(
        select(ConversationMembers.user_id)
        .filter_by(conversation_id=conversation_id)
        .with_for_update(key_share=True)
    )
    member_ids = list(result.scalars().all())
    if sender_id not in member_ids:
        raise UserNotInConversation(
            user_id=sender_id,
            conversation_id=conversation_id,
        )
    recipient_ids = [
        member_id for member_id in member_ids if member_id != sender_id
    ]
    if not recipient_ids:
        return
    await cursor.execute(
        postgresql_insert(UnreadMessages)
        .values(
            [
                {
                    "conversation_id": conversation_id,
                    "user_id": user_id,
                    "message_id": message_id,
                }
                for user_id in recipient_ids
            ]
        )
        .on_conflict_do_nothing()
    )
    await cursor.execute(
        postgresql_insert(MessageReceipts)
        .values(
            [
                {
                    "message_id": message_id,
                    "user_id": user_id,
                    "status": MessagesStatus.SENT,
                }
                for user_id in recipient_ids
            ]
        )
        .on_conflict_do_nothing(
            index_elements=["message_id", "user_id"],
        )
    )


async def reserve_message_id() -> int:
    async with session() as cursor:
        result = await cursor.execute(
            select(
                text(
                    "nextval(pg_get_serial_sequence("
                    f"'{Messages.__table__.fullname}', 'id'))"
                )
            )
        )
        return result.scalar_one()


async def insert_text_message_with_notifications(
    sender_id: int,
    conversation_id: int,
    message_data: CreateTextMessageDB | CreateEncryptedMessageDB,
) -> tuple[int, bool]:
    async with session() as cursor:
        values = {
            "sender_id": sender_id,
            "conversation_id": conversation_id,
            **message_data.model_dump(exclude_none=True),
        }
        client_message_id = values.get("client_message_id")
        if client_message_id is not None:
            values["client_message_id"] = str(client_message_id)
            statement = (
                postgresql_insert(Messages)
                .values(**values)
                .on_conflict_do_nothing(
                    constraint="uq_messages_sender_client_id",
                )
                .returning(Messages.id)
            )
        else:
            statement = insert(Messages).values(**values).returning(Messages.id)
        result = await cursor.execute(statement)
        message_id = result.scalar_one_or_none()
        created = message_id is not None
        if message_id is None:
            existing = await cursor.execute(
                select(Messages.id).filter_by(
                    sender_id=sender_id,
                    client_message_id=str(client_message_id),
                )
            )
            message_id = existing.scalar_one()
        if created:
            await _insert_notifications(
                cursor=cursor,
                sender_id=sender_id,
                conversation_id=conversation_id,
                message_id=message_id,
            )
        await cursor.commit()
        return message_id, created


async def insert_call_history_message(
    call_id: int,
    sender_id: int,
    conversation_id: int,
    content: str,
) -> tuple[int, bool]:
    """Persist one idempotent timeline entry for a finished call."""
    client_message_id = str(uuid5(NAMESPACE_URL, f"chatwave-call:{call_id}"))
    async with session() as cursor:
        result = await cursor.execute(
            postgresql_insert(Messages)
            .values(
                sender_id=sender_id,
                conversation_id=conversation_id,
                status=MessagesStatus.SENT,
                type=MessagesTypes.TEXT,
                content=content,
                client_message_id=client_message_id,
            )
            .on_conflict_do_nothing(
                constraint="uq_messages_sender_client_id",
            )
            .returning(Messages.id)
        )
        message_id = result.scalar_one_or_none()
        created = message_id is not None
        if message_id is None:
            existing = await cursor.execute(
                select(Messages.id).filter_by(
                    sender_id=sender_id,
                    client_message_id=client_message_id,
                )
            )
            message_id = existing.scalar_one()
        if created:
            await _insert_notifications(
                cursor=cursor,
                sender_id=sender_id,
                conversation_id=conversation_id,
                message_id=message_id,
            )
        await cursor.commit()
        return message_id, created


async def insert_media_message_with_notifications(
    message_id: int,
    sender_id: int,
    conversation_id: int,
    message_data: CreateMediaMessageDB,
) -> tuple[int, bool]:
    async with session() as cursor:
        await cursor.execute(
            select(func.pg_advisory_xact_lock(9001, sender_id))
        )
        usage_result = await cursor.execute(
            select(func.coalesce(func.sum(Messages.file_size), 0)).filter(
                Messages.sender_id == sender_id
            )
        )
        quota_bytes = (
            generic_settings.MAX_MEDIA_STORAGE_PER_USER_MB * 1024 * 1024
        )
        if usage_result.scalar_one() + message_data.file_size > quota_bytes:
            raise StorageQuotaExceeded()
        values = {
            "id": message_id,
            "sender_id": sender_id,
            "conversation_id": conversation_id,
            **message_data.model_dump(exclude_none=True),
        }
        client_message_id = values.get("client_message_id")
        if client_message_id is not None:
            values["client_message_id"] = str(client_message_id)
            statement = (
                postgresql_insert(Messages)
                .values(**values)
                .on_conflict_do_nothing(
                    constraint="uq_messages_sender_client_id",
                )
                .returning(Messages.id)
            )
        else:
            statement = insert(Messages).values(**values).returning(Messages.id)
        result = await cursor.execute(statement)
        persisted_id = result.scalar_one_or_none()
        created = persisted_id is not None
        if persisted_id is None:
            existing = await cursor.execute(
                select(Messages.id).filter_by(
                    sender_id=sender_id,
                    client_message_id=str(client_message_id),
                )
            )
            persisted_id = existing.scalar_one()
        if created:
            await _insert_notifications(
                cursor=cursor,
                sender_id=sender_id,
                conversation_id=conversation_id,
                message_id=persisted_id,
            )
        await cursor.commit()
        return persisted_id, created


async def update_message(message_id: int, content: str) -> None:
    async with session() as cursor:
        query = (
            update(Messages)
            .filter_by(id=message_id)
            .values(content=content)
        )
        await cursor.execute(query)
        await cursor.commit()


async def update_voice_transcript(
    message_id: int,
    transcript: str,
    language: str | None,
) -> None:
    async with session() as cursor:
        await cursor.execute(
            update(Messages)
            .filter_by(id=message_id)
            .values(
                voice_transcript=transcript,
                transcript_language=language,
                updated_at=text("updated_at"),
            )
        )
        await cursor.commit()


async def select_message(message_id: int) -> Messages:
    async with session() as cursor:
        query = (
            select(Messages)
            .filter_by(id=message_id)
        )
        result = await cursor.execute(query)
        return result.scalar()


async def select_message_by_client_id(
    sender_id: int,
    client_message_id: str,
) -> Messages | None:
    async with session() as cursor:
        result = await cursor.execute(
            select(Messages).filter_by(
                sender_id=sender_id,
                client_message_id=client_message_id,
            )
        )
        return result.scalar()


async def select_messages(messages_ids: list[int]) -> list[Messages]:
    async with session() as cursor:
        query = (
            select(Messages)
            .options(selectinload(Messages.conversation))
            .filter(Messages.id.in_(messages_ids))
        )
        result = await cursor.execute(query)
        return result.scalars()


async def select_message_status(message_id: int) -> MessagesStatus:
    async with session() as cursor:
        query = (
            select(Messages.status)
            .filter_by(id=message_id)
        )
        raw_data = await cursor.execute(query)
        return raw_data.scalar()


async def select_filtered_messages(
    conversation_id: int,
    limit: int,
    offset: int,
    before_id: int | None = None,
) -> list[Messages]:
    async with session() as cursor:
        query = (
            select(Messages)
            .filter(
                and_(
                    Messages.conversation_id == conversation_id,
                    Messages.status != MessagesStatus.CREATED
                )
            )
            .filter(Messages.id < before_id if before_id is not None else True)
            .order_by(Messages.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await cursor.execute(query)
        result = result.scalars().all()

        return result


async def select_last_message(conversation_id: int) -> Messages:
    async with session() as cursor:
        query = (
            select(Messages)
            .filter(
                and_(
                    Messages.conversation_id == conversation_id,
                    Messages.status != MessagesStatus.CREATED
                )
            )
            .order_by(Messages.created_at.desc())
            .limit(1)
        )
        result = await cursor.execute(query)
        result = result.scalar()

        return result


async def select_messages_by_content(conversation_id: int, search_query: str, limit: int) -> list[Messages]:
    async with session() as cursor:
        query = (
            select(Messages)
            .filter_by(conversation_id=conversation_id)
            .filter(Messages.content.icontains(search_query, autoescape=True))
            .limit(limit)
        )
        result = await cursor.execute(query)
        return result.scalars().all()


async def select_conversation_messages_by_types(
    conversation_id: int,
    message_types: list[MessagesTypes],
    limit: int,
    offset: int,
) -> list[Messages]:
    async with session() as cursor:
        result = await cursor.execute(
            select(Messages)
            .filter(
                Messages.conversation_id == conversation_id,
                Messages.type.in_(message_types),
                Messages.status != MessagesStatus.CREATED,
            )
            .order_by(Messages.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())


async def insert_pinned_message(
    conversation_id: int,
    message_id: int,
    pinned_by: int,
) -> None:
    async with session() as cursor:
        await cursor.execute(
            postgresql_insert(PinnedMessages)
            .values(
                conversation_id=conversation_id,
                message_id=message_id,
                pinned_by=pinned_by,
            )
            .on_conflict_do_nothing(constraint="uq_pinned_messages_message")
        )
        await cursor.commit()


async def delete_pinned_message(message_id: int) -> None:
    async with session() as cursor:
        await cursor.execute(
            delete(PinnedMessages).filter_by(message_id=message_id)
        )
        await cursor.commit()


async def select_pinned_messages(conversation_id: int) -> list[Messages]:
    async with session() as cursor:
        result = await cursor.execute(
            select(Messages)
            .join(PinnedMessages, PinnedMessages.message_id == Messages.id)
            .filter(PinnedMessages.conversation_id == conversation_id)
            .order_by(PinnedMessages.created_at.desc())
        )
        return list(result.scalars().all())


async def delete_conversation_messages(conversation_id: int) -> None:
    async with session() as cursor:
        query = (
            delete(Messages)
            .filter_by(conversation_id=conversation_id)
        )
        await cursor.execute(query)
        await cursor.commit()


async def delete_messages(messages_ids: list[int]) -> None:
    async with session() as cursor:
        query = (
            delete(Messages)
            .filter(Messages.id.in_(messages_ids))
        )
        await cursor.execute(query)
        await cursor.commit()


async def delete_sender_messages(conversation_id: int, members_ids: list[int]) -> None:
    async with session() as cursor:
        query = (
            delete(Messages)
            .filter(
                and_(
                    Messages.conversation_id == conversation_id,
                    Messages.sender_id.in_(members_ids)
                )
            )
        )
        await cursor.execute(query)
        await cursor.commit()


async def select_conversation_media_names(conversation_id: int) -> list[str]:
    async with session() as cursor:
        result = await cursor.execute(
            select(Messages.file_content_name).filter(
                Messages.conversation_id == conversation_id,
                Messages.file_content_name.is_not(None),
            )
        )
        return list(result.scalars().all())


async def select_sender_media_names(
    conversation_id: int,
    members_ids: list[int],
) -> list[str]:
    if not members_ids:
        return []
    async with session() as cursor:
        result = await cursor.execute(
            select(Messages.file_content_name).filter(
                Messages.conversation_id == conversation_id,
                Messages.sender_id.in_(members_ids),
                Messages.file_content_name.is_not(None),
            )
        )
        return list(result.scalars().all())
