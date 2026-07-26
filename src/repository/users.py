from datetime import datetime
from sqlalchemy import select, insert, update, text, delete
from sqlalchemy.orm import selectinload

from models import Users, Conversations, UserAvatars
from database import session
from schemas import CreateUserDB, UpdateUserDB


async def is_user_exists(user_id: int) -> bool:
    async with session() as cursor:
        query = (
            select(Users.id)
            .filter_by(id=user_id)
        )
        result = await cursor.execute(query)
        if result.first():
            return True

        return False


async def select_user_by_username(username: str) -> tuple[int, str]:
    async with session() as cursor:
        query = (
            select(Users.id, Users.password_hash)
            .filter_by(username=username)
        )
        raw_data = await cursor.execute(query)
        raw_data = raw_data.first()

        return raw_data


async def insert_user(user_data: CreateUserDB) -> None:
    async with session() as cursor:
        query = (
            insert(Users)
            .values(**user_data.model_dump())
        )
        await cursor.execute(query)
        await cursor.commit()


async def select_user(user_id: int) -> Users:
    async with session() as cursor:
        query = select(Users).filter_by(id=user_id)
        raw_data = await cursor.execute(query)
        return raw_data.scalar()


async def select_user_avatar_type(avatar_name: str) -> str | None:
    async with session() as cursor:
        result = await cursor.execute(
            select(UserAvatars.avatar_type).filter_by(avatar_name=avatar_name)
        )
        return result.scalar()


async def insert_user_avatar(
    user_id: int,
    avatar_name: str,
    avatar_type: str,
) -> None:
    async with session() as cursor:
        await cursor.execute(
            insert(UserAvatars).values(
                user_id=user_id,
                avatar_name=avatar_name,
                avatar_type=avatar_type,
            )
        )
        await cursor.commit()


async def set_user_avatar(
    user_id: int,
    avatar_name: str,
    avatar_type: str,
    *,
    add_to_history: bool,
) -> None:
    async with session() as cursor:
        if add_to_history:
            await cursor.execute(
                insert(UserAvatars).values(
                    user_id=user_id,
                    avatar_name=avatar_name,
                    avatar_type=avatar_type,
                )
            )
        await cursor.execute(
            update(Users)
            .filter_by(id=user_id)
            .values(avatar_name=avatar_name, avatar_type=avatar_type)
        )
        await cursor.commit()


async def select_user_avatar_history(user_id: int) -> list[UserAvatars]:
    async with session() as cursor:
        result = await cursor.execute(
            select(UserAvatars)
            .filter_by(user_id=user_id)
            .order_by(UserAvatars.created_at.desc(), UserAvatars.id.desc())
        )
        return list(result.scalars().all())


async def select_owned_user_avatar(
    user_id: int,
    avatar_name: str,
) -> UserAvatars | None:
    async with session() as cursor:
        result = await cursor.execute(
            select(UserAvatars).filter_by(
                user_id=user_id,
                avatar_name=avatar_name,
            )
        )
        return result.scalar()


async def select_user_avatar_names(user_id: int) -> list[str]:
    async with session() as cursor:
        result = await cursor.execute(
            select(UserAvatars.avatar_name).filter_by(user_id=user_id)
        )
        return list(result.scalars().all())


async def select_user_with_conversations(user_id: int) -> Users:
    async with session() as cursor:
        result = await cursor.execute(
            select(Users)
            .options(
                selectinload(Users.conversations)
                .selectinload(Conversations.members)
            )
            .filter_by(id=user_id)
        )
        return result.scalar()


async def select_user_with_unread(user_id: int) -> Users:
    async with session() as cursor:
        result = await cursor.execute(
            select(Users)
            .options(selectinload(Users.unread_messages))
            .filter_by(id=user_id)
        )
        return result.scalar()


async def select_users(users_ids: list[int]) -> list[Users]:
    async with session() as cursor:
        query = (
            select(Users)
            .filter(Users.id.in_(users_ids))
        )
        raw_data = await cursor.execute(query)
        raw_data = raw_data.scalars().all()

        return raw_data


async def select_users_by_username(search_query: str, limit: int | None) -> list[Users]:

    async def query_builder():
        normalized_query = search_query.strip().lower().removeprefix("@")
        if limit is None:
            _query = (
                select(Users)
                .filter(Users.username.istartswith(normalized_query, autoescape=True))
                .order_by(Users.username)
            )
        else:
            _query = (
                select(Users)
                .filter(Users.username.istartswith(normalized_query, autoescape=True))
                .order_by(Users.username)
                .limit(limit)
            )

        return _query

    async with session() as cursor:
        query = await query_builder()
        raw_data = await cursor.execute(query)
        raw_data = raw_data.scalars().all()

        return raw_data


async def update_user(user_id: int, user_data: UpdateUserDB) -> None:
    async with session() as cursor:
        query = (
            update(Users)
            .filter_by(id=user_id)
            .values(**user_data.model_dump(exclude_none=True))
        )
        await cursor.execute(query)
        await cursor.commit()


async def delete_user_avatar(user_id: int) -> None:
    async with session() as cursor:
        query = (
            update(Users)
            .filter_by(id=user_id)
            .values(
                avatar_name=None,
                avatar_type=None
            )
        )
        await cursor.execute(query)
        await cursor.commit()


async def update_user_last_online(user_id: int) -> None:
    async with session() as cursor:
        query = (
            update(Users)
            .filter_by(id=user_id)
            .values(
                last_online=text("TIMEZONE('utc', now())"),
                updated_at=text("updated_at")
            )
        )
        await cursor.execute(query)
        await cursor.commit()


async def select_users_last_online(users_ids: list[int]) -> list[tuple[int, datetime]]:
    async with session() as cursor:
        query = (
            select(Users.id, Users.last_online)
            .filter(Users.id.in_(users_ids))
        )
        raw_data = await cursor.execute(query)
        raw_data = raw_data.all()

        return raw_data


async def delete_user(user_id: int) -> None:
    async with session() as cursor:
        query = (
            delete(Users)
            .filter_by(id=user_id)
        )
        await cursor.execute(query)
        await cursor.commit()


async def is_user_avatar_uuid_existed(avatar_uuid: str) -> bool:
    async with session() as cursor:
        query = select(UserAvatars.id).filter_by(avatar_name=avatar_uuid)
        result = await cursor.execute(query)
        if result.first():
            return True

        return False
