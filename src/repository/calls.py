from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import insert, select, update

from database import session
from models import Calls, ConversationMembers
from utilities import CallsStatus


@dataclass(frozen=True)
class CallTransition:
    id: int
    conversation_id: int
    caller_id: int
    status: CallsStatus
    duration: int | None
    started_at: datetime
    finished_at: datetime | None


async def select_call(call_id: int) -> Calls | None:
    async with session() as cursor:
        result = await cursor.execute(
            select(Calls).filter_by(id=call_id)
        )
        return result.scalar()


async def insert_call(conversation_id: int, caller_id: int) -> int:
    async with session() as cursor:
        result = await cursor.execute(
            insert(Calls)
            .values(
                conversation_id=conversation_id,
                caller_id=caller_id,
                status=CallsStatus.PENDING,
            )
            .returning(Calls)
        )
        call = result.scalar_one()
        call_id = call.id
        await cursor.commit()
        return call_id


async def select_call_participants(call_id: int) -> tuple[Calls | None, list[int]]:
    async with session() as cursor:
        call_result = await cursor.execute(
            select(Calls).filter_by(id=call_id)
        )
        call = call_result.scalar()
        if call is None:
            return None, []
        members_result = await cursor.execute(
            select(ConversationMembers.user_id).filter_by(
                conversation_id=call.conversation_id
            )
        )
        return call, list(members_result.scalars().all())


async def transition_call_status(
    call_id: int,
    from_statuses: list[CallsStatus],
    to_status: CallsStatus,
) -> CallTransition | None:
    values: dict[str, object] = {"status": to_status}
    finished_at_utc: datetime | None = None
    if to_status in (CallsStatus.COMPLETED, CallsStatus.MISSED):
        finished_at_utc = datetime.now(timezone.utc)
        # The legacy schema stores UTC in TIMESTAMP WITHOUT TIME ZONE.
        values["finished_at"] = finished_at_utc.replace(tzinfo=None)

    async with session() as cursor:
        result = await cursor.execute(
            update(Calls)
            .where(
                Calls.id == call_id,
                Calls.status.in_(from_statuses),
            )
            .values(**values)
            .returning(Calls)
        )
        call = result.scalar()
        duration = call.duration if call is not None else None
        if call is not None and to_status == CallsStatus.COMPLETED:
            assert finished_at_utc is not None
            started_at = call.started_at
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)
            duration = max(
                0,
                int((finished_at_utc - started_at).total_seconds()),
            )
            await cursor.execute(
                update(Calls).filter_by(id=call_id).values(duration=duration)
            )
        snapshot = (
            CallTransition(
                id=call.id,
                conversation_id=call.conversation_id,
                caller_id=call.caller_id,
                status=call.status,
                duration=duration,
                started_at=call.started_at,
                finished_at=call.finished_at,
            )
            if call is not None
            else None
        )
        await cursor.commit()
        return snapshot
