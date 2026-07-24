from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert

from database import session
from models import MessageReceipts, UnreadMessages
from utilities import MessagesStatus


async def upsert_message_receipts(message_id: int, users_ids: list[int]) -> None:
    if not users_ids:
        return
    async with session() as cursor:
        await cursor.execute(
            insert(MessageReceipts)
            .values(
                [
                    {
                        "message_id": message_id,
                        "user_id": user_id,
                        "status": MessagesStatus.SENT,
                    }
                    for user_id in users_ids
                ]
            )
            .on_conflict_do_nothing(
                index_elements=["message_id", "user_id"],
            )
        )
        await cursor.commit()


async def update_message_receipt(
    message_id: int,
    user_id: int,
    status: MessagesStatus,
) -> None:
    async with session() as cursor:
        query = update(MessageReceipts).filter_by(
            message_id=message_id,
            user_id=user_id,
        )
        if status == MessagesStatus.DELIVERED:
            query = query.filter(MessageReceipts.status == MessagesStatus.SENT)
        elif status == MessagesStatus.READ:
            query = query.filter(MessageReceipts.status != MessagesStatus.READ)
        await cursor.execute(query.values(status=status))
        await cursor.commit()


async def select_message_receipt_status(
    message_id: int,
    user_id: int,
) -> MessagesStatus | None:
    async with session() as cursor:
        result = await cursor.execute(
            select(MessageReceipts.status).filter_by(
                message_id=message_id,
                user_id=user_id,
            )
        )
        return result.scalar()


async def select_message_receipts_statuses(message_id: int) -> list[MessagesStatus]:
    async with session() as cursor:
        result = await cursor.execute(
            select(MessageReceipts.status).filter_by(message_id=message_id)
        )
        return list(result.scalars().all())


async def mark_message_receipts_read(
    user_id: int,
    message_ids: list[int],
) -> None:
    if not message_ids:
        return
    async with session() as cursor:
        await cursor.execute(
            update(MessageReceipts)
            .filter(
                MessageReceipts.user_id == user_id,
                MessageReceipts.message_id.in_(message_ids),
                MessageReceipts.status != MessagesStatus.READ,
            )
            .values(status=MessagesStatus.READ)
        )
        await cursor.execute(
            delete(UnreadMessages).filter(
                UnreadMessages.user_id == user_id,
                UnreadMessages.message_id.in_(message_ids),
            )
        )
        await cursor.commit()


async def mark_message_receipts_delivered(
    user_id: int,
    message_ids: list[int],
) -> None:
    if not message_ids:
        return
    async with session() as cursor:
        await cursor.execute(
            update(MessageReceipts)
            .filter(
                MessageReceipts.user_id == user_id,
                MessageReceipts.message_id.in_(message_ids),
                MessageReceipts.status == MessagesStatus.SENT,
            )
            .values(status=MessagesStatus.DELIVERED)
        )
        await cursor.commit()


async def select_receipts_for_messages(
    message_ids: list[int],
) -> list[tuple[int, int, MessagesStatus]]:
    if not message_ids:
        return []
    async with session() as cursor:
        result = await cursor.execute(
            select(
                MessageReceipts.message_id,
                MessageReceipts.user_id,
                MessageReceipts.status,
            ).filter(MessageReceipts.message_id.in_(message_ids))
        )
        return list(result.all())
