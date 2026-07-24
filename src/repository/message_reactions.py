from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from database import session
from models import MessageReactions


async def toggle_message_reaction(
    message_id: int,
    user_id: int,
    emoji: str,
) -> None:
    async with session() as cursor:
        existing = await cursor.execute(
            select(MessageReactions.emoji).filter_by(
                message_id=message_id,
                user_id=user_id,
            )
        )
        existing_emoji = existing.scalar()
        if existing_emoji == emoji:
            await cursor.execute(
                delete(MessageReactions).filter_by(
                    message_id=message_id,
                    user_id=user_id,
                )
            )
        else:
            await cursor.execute(
                insert(MessageReactions)
                .values(
                    message_id=message_id,
                    user_id=user_id,
                    emoji=emoji,
                )
                .on_conflict_do_update(
                    index_elements=["message_id", "user_id"],
                    set_={"emoji": emoji},
                )
            )
        await cursor.commit()


async def select_message_reactions(
    message_ids: list[int],
) -> list[tuple[int, int, str]]:
    if not message_ids:
        return []
    async with session() as cursor:
        result = await cursor.execute(
            select(
                MessageReactions.message_id,
                MessageReactions.user_id,
                MessageReactions.emoji,
            ).filter(MessageReactions.message_id.in_(message_ids))
        )
        return list(result.all())
