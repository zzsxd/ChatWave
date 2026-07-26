from sqlalchemy import select, update, delete, insert, func
from sqlalchemy.orm import selectinload

from models import Conversations, ConversationMembers
from database import session
from schemas import EditConversationDB, CreateEmptyConversation, CreateGroupDB
from utilities import (
    ChatAlreadyExists,
    ConversationMemberRoles,
    ConversationTypes,
)


async def is_conversation_exists(conversation_id: int) -> bool:
    async with session() as cursor:
        query = (
            select(Conversations.id)
            .filter_by(id=conversation_id)
        )
        result = await cursor.execute(query)
        if result.first():
            return True

        return False


async def select_conversation_type(conversation_id: int) -> ConversationTypes:
    async with session() as cursor:
        query = (
            select(Conversations.type)
            .filter_by(id=conversation_id)
        )
        result = await cursor.execute(query)
        return result.scalar()


async def select_conversation(conversation_obj: CreateEmptyConversation | CreateGroupDB) -> Conversations.id:
    async with session() as cursor:
        query = (
            insert(Conversations).returning(Conversations.id)
            .values(
                **conversation_obj.model_dump(exclude_none=True)
            )
        )
        raw_data = await cursor.execute(query)
        await cursor.commit()
        raw_data = raw_data.scalar()

        return raw_data


async def create_private_conversation_atomic(
    user_id: int,
    recipient_id: int,
) -> int:
    first_id, second_id = sorted((user_id, recipient_id))
    lock_key = (first_id << 32) | second_id

    async with session() as cursor:
        await cursor.execute(select(func.pg_advisory_xact_lock(lock_key)))
        result = await cursor.execute(
            select(Conversations.id)
            .join(
                ConversationMembers,
                ConversationMembers.conversation_id == Conversations.id,
            )
            .filter(Conversations.type == ConversationTypes.PRIVATE)
            .group_by(Conversations.id)
            .having(
                func.count(ConversationMembers.user_id) == 2,
                func.count(ConversationMembers.user_id)
                .filter(ConversationMembers.user_id.in_([first_id, second_id]))
                == 2,
            )
            .limit(1)
        )
        existing_id = result.scalar()
        if existing_id is not None:
            raise ChatAlreadyExists(chat_id=existing_id)

        result = await cursor.execute(
            insert(Conversations)
            .values(
                creator_id=user_id,
                type=ConversationTypes.PRIVATE,
            )
            .returning(Conversations.id)
        )
        conversation_id = result.scalar_one()
        await cursor.execute(
            insert(ConversationMembers).values(
                [
                    {
                        "user_id": participant_id,
                        "conversation_id": conversation_id,
                        "role": ConversationMemberRoles.MEMBER,
                    }
                    for participant_id in (first_id, second_id)
                ]
            )
        )
        await cursor.commit()
        return conversation_id


async def create_group_conversation_atomic(
    creator_id: int,
    conversation_obj: CreateGroupDB,
) -> int:
    async with session() as cursor:
        result = await cursor.execute(
            insert(Conversations)
            .values(**conversation_obj.model_dump(exclude_none=True))
            .returning(Conversations.id)
        )
        conversation_id = result.scalar_one()
        await cursor.execute(
            insert(ConversationMembers).values(
                user_id=creator_id,
                conversation_id=conversation_id,
                role=ConversationMemberRoles.CREATOR,
            )
        )
        await cursor.commit()
        return conversation_id


async def get_or_create_saved_conversation_atomic(user_id: int) -> int:
    marker = "__chatwave_saved__"
    async with session() as cursor:
        await cursor.execute(
            select(func.pg_advisory_xact_lock((1 << 31) | user_id))
        )
        result = await cursor.execute(
            select(Conversations.id)
            .join(
                ConversationMembers,
                ConversationMembers.conversation_id == Conversations.id,
            )
            .filter(
                Conversations.creator_id == user_id,
                Conversations.type == ConversationTypes.GROUP,
                Conversations.description == marker,
            )
            .group_by(Conversations.id)
            .having(
                func.count(ConversationMembers.user_id) == 1,
                func.count(ConversationMembers.user_id)
                .filter(ConversationMembers.user_id == user_id)
                == 1,
            )
            .limit(1)
        )
        existing_id = result.scalar()
        if existing_id is not None:
            return existing_id

        result = await cursor.execute(
            insert(Conversations)
            .values(
                creator_id=user_id,
                type=ConversationTypes.GROUP,
                name="Избранное",
                description=marker,
            )
            .returning(Conversations.id)
        )
        conversation_id = result.scalar_one()
        await cursor.execute(
            insert(ConversationMembers).values(
                user_id=user_id,
                conversation_id=conversation_id,
                role=ConversationMemberRoles.CREATOR,
            )
        )
        await cursor.commit()
        return conversation_id


async def select_conversation_by_id(conversation_id: int) -> Conversations:
    async with session() as cursor:
        query = (
            select(Conversations)
            .options(selectinload(Conversations.members))
            .filter_by(id=conversation_id)
        )
        result = await cursor.execute(query)
        return result.scalar()


async def select_conversations(conversations_ids: list[int]) -> list[Conversations]:
    async with session() as cursor:
        query = (
            select(Conversations)
            .options(selectinload(Conversations.members))
            .filter(Conversations.id.in_(conversations_ids))
        )
        result = await cursor.execute(query)
        return result.scalars().all()


async def delete_conversation_avatar(conversation_id: int) -> None:
    async with session() as cursor:
        query = (
            update(Conversations)
            .filter_by(id=conversation_id)
            .values(
                avatar_name=None,
                avatar_type=None
            )
        )
        await cursor.execute(query)
        await cursor.commit()


async def update_conversation(conversation_id: int, conversation_obj: EditConversationDB):
    async with session() as cursor:
        query = (
            update(Conversations)
            .filter_by(id=conversation_id)
            .values(**conversation_obj.model_dump(exclude_none=True))
        )
        await cursor.execute(query)
        await cursor.commit()


async def update_conversation_creator(conversation_id: int, creator_id: int) -> None:
    async with session() as cursor:
        await cursor.execute(
            update(Conversations)
            .filter_by(id=conversation_id)
            .values(creator_id=creator_id)
        )
        await cursor.commit()


async def delete_conversation(conversation_id: int) -> None:
    async with session() as cursor:
        query = (
            delete(Conversations)
            .filter_by(id=conversation_id)
        )
        await cursor.execute(query)
        await cursor.commit()


async def is_group_avatar_uuid_existed(avatar_uuid: str) -> bool:
    async with session() as cursor:
        query = (
            select(Conversations.id)
            .filter_by(avatar_name=avatar_uuid)
        )
        result = await cursor.execute(query)
        if result.first():
            return True

        return False
