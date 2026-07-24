from sqlalchemy import select, func, delete
from sqlalchemy.dialects.postgresql import insert

from models import MessageReceipts, UnreadMessages
from database import session
from schemas import FilterUnreadMessages
from schemas.unread_messages import UnreadMessageExistedDTO, AddUnreadMessagesDB
from utilities import MessagesStatus


async def is_unread_messages_exists(filter_conditions: UnreadMessageExistedDTO) -> bool:
    async with session() as cursor:
        query = (
            select(func.count())
            .select_from(UnreadMessages)
            .filter_by(**filter_conditions.model_dump(exclude_none=True))
        )
        raw_data = await cursor.execute(query)
        if raw_data.scalar() > 0:
            return True

        return False


async def select_unread_messages(
    filter_conditions: FilterUnreadMessages,
    limit: int | None = None,
    offset: int = 0,
) -> list[UnreadMessages]:
    async with session() as cursor:
        query = (
            select(UnreadMessages)
            .filter_by(**filter_conditions.model_dump(exclude_none=True))
            .order_by(UnreadMessages.id)
            .offset(offset)
        )
        if limit is not None:
            query = query.limit(limit)
        raw_data = await cursor.execute(query)
        return raw_data.scalars().all()


async def insert_unread_messages(unread_messages_data: AddUnreadMessagesDB) -> None:
    async with session() as cursor:
        if unread_messages_data.users_ids:
            await cursor.execute(
                insert(UnreadMessages)
                .values([
                    {
                        "user_id": user_id,
                        **unread_messages_data.model_dump(
                            exclude_none=True,
                            exclude={"users_ids"},
                        ),
                    }
                    for user_id in unread_messages_data.users_ids
                ])
                .on_conflict_do_nothing()
            )

        await cursor.commit()


async def insert_message_notifications(
    conversation_id: int,
    message_id: int,
    users_ids: list[int],
) -> None:
    if not users_ids:
        return
    async with session() as cursor:
        await cursor.execute(
            insert(UnreadMessages)
            .values(
                [
                    {
                        "conversation_id": conversation_id,
                        "user_id": user_id,
                        "message_id": message_id,
                    }
                    for user_id in users_ids
                ]
            )
            .on_conflict_do_nothing()
        )
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


async def delete_unread_messages(filter_conditions: FilterUnreadMessages) -> None:
    async with session() as cursor:
        query = (
            delete(UnreadMessages)
            .filter_by(**filter_conditions.model_dump(exclude_none=True))
        )
        await cursor.execute(query)
        await cursor.commit()
