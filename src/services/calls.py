import json
import logging

from fastapi import WebSocket
from pydantic import ValidationError

from dependencies import redis_client
from repository import (
    insert_call,
    insert_call_history_message,
    select_message,
    select_call_participants,
    select_conversation_members,
    transition_call_status,
)
from schemas import (
    AcceptCall,
    CallAction,
    CallCandidate,
    CallHeartbeat,
    CallMediaState,
    GroupCallAnswer,
    GroupCallCandidate,
    GroupCallMediaState,
    GroupCallOffer,
    JoinGroupCall,
    LeaveGroupCall,
    StartGroupCall,
    StartCall,
    parse_call_signal,
)
from utilities import (
    CallsStatus,
    ConversationNotFoundError,
    IsNotAChatError,
    IsNotAGroupError,
    UserNotInConversation,
    sqlalchemy_to_pydantic,
)
from schemas import GetMessage
from .message_events import publish_message_created
from validators import validate_user_in_chat, validate_user_in_group


CALL_LOCK_SECONDS = 120
ACTIVE_CALL_LOCK_SECONDS = 90
logger = logging.getLogger(__name__)
CALL_HISTORY_PREFIX = "__chatwave_call__:"
GROUP_CALL_MAX_PARTICIPANTS = 8
GROUP_CALL_TTL_SECONDS = 90


def _group_key(call_id: int) -> str:
    return f"call:{call_id}:group"


def _group_participants_key(call_id: int) -> str:
    return f"call:{call_id}:participants"


async def _is_group_call(call_id: int) -> bool:
    return bool(await redis_client.exists(_group_key(call_id)))


async def _group_participants(call_id: int) -> set[int]:
    values = await redis_client.smembers(_group_participants_key(call_id))
    return {
        int(value.decode() if isinstance(value, bytes) else value)
        for value in values
    }


async def _refresh_group_call(call_id: int, conversation_id: int) -> None:
    await redis_client.expire(_group_key(call_id), GROUP_CALL_TTL_SECONDS)
    await redis_client.expire(
        _group_participants_key(call_id),
        GROUP_CALL_TTL_SECONDS,
    )
    await redis_client.expire(
        f"call:conversation:{conversation_id}:active",
        ACTIVE_CALL_LOCK_SECONDS,
    )


async def _active_group_call_id(conversation_id: int) -> int | None:
    active_value = await redis_client.get(
        f"call:conversation:{conversation_id}:active"
    )
    if active_value is None:
        return None
    try:
        call_id = int(active_value.decode())
    except (AttributeError, ValueError):
        return None
    call, _ = await select_call_participants(call_id)
    if (
        call is None
        or call.conversation_id != conversation_id
        or call.status != CallsStatus.COMING
        or not await _is_group_call(call_id)
    ):
        return None
    return call_id


async def _record_call_history(call, outcome: str) -> None:
    call_id = call.id
    try:
        content = CALL_HISTORY_PREFIX + json.dumps(
            {
                "call_id": call.id,
                "outcome": outcome,
                "duration": call.duration or 0,
                "started_at": call.started_at.isoformat(),
            },
            separators=(",", ":"),
        )
        message_id, created = await insert_call_history_message(
            call_id=call.id,
            sender_id=call.caller_id,
            conversation_id=call.conversation_id,
            content=content,
        )
        if not created:
            return
        raw_message = await select_message(message_id)
        message = await sqlalchemy_to_pydantic(
            sqlalchemy_model=raw_message,
            pydantic_model=GetMessage,
        )
        await publish_message_created(message)
    except Exception:
        logger.exception("Unable to record history for call %s", call_id)


async def _send_error(websocket: WebSocket, code: str, detail: str) -> None:
    await websocket.send_json({"type": "call.error", "code": code, "detail": detail})


async def _publish(user_id: int, payload: dict) -> None:
    await redis_client.publish(
        f"user:call_events:{user_id}",
        json.dumps(payload, separators=(",", ":")),
    )


async def _resolve_call(
    current_user_id: int,
    call_id: int,
) -> tuple[object | None, int | None]:
    call, participant_ids = await select_call_participants(call_id)
    if (
        call is None
        or len(participant_ids) != 2
        or current_user_id not in participant_ids
    ):
        return None, None
    recipient_id = next(
        participant_id
        for participant_id in participant_ids
        if participant_id != current_user_id
    )
    return call, recipient_id


async def _release_call_lock(conversation_id: int, call_id: int) -> None:
    key = f"call:conversation:{conversation_id}:active"
    active_call_id = await redis_client.get(key)
    if active_call_id is not None and active_call_id.decode() == str(call_id):
        await redis_client.delete(key)


async def _acquire_call_lock(conversation_id: int) -> bool:
    lock_key = f"call:conversation:{conversation_id}:active"
    if await redis_client.set(
        lock_key,
        "creating",
        ex=CALL_LOCK_SECONDS,
        nx=True,
    ):
        return True

    active_value = await redis_client.get(lock_key)
    if active_value is None:
        return bool(
            await redis_client.set(
                lock_key,
                "creating",
                ex=CALL_LOCK_SECONDS,
                nx=True,
            )
        )
    try:
        active_call_id = int(active_value.decode())
    except ValueError:
        return False

    active_call, _ = await select_call_participants(active_call_id)
    ttl = await redis_client.ttl(lock_key)
    stale = active_call is None or active_call.status not in {
        CallsStatus.PENDING,
        CallsStatus.COMING,
    }
    # Locks from versions without heartbeat lived for two hours.
    if (
        active_call is not None
        and active_call.status == CallsStatus.COMING
        and ttl > ACTIVE_CALL_LOCK_SECONDS
    ):
        stale = True
    if not stale:
        return False

    await redis_client.delete(lock_key)
    return bool(
        await redis_client.set(
            lock_key,
            "creating",
            ex=CALL_LOCK_SECONDS,
            nx=True,
        )
    )


async def _handle_start(
    current_user_id: int,
    signal: StartCall,
    websocket: WebSocket,
) -> int | None:
    if signal.offer.type != "offer":
        await _send_error(websocket, "invalid_offer", "Expected an SDP offer")
        return None

    await validate_user_in_chat(current_user_id, signal.conversation_id)
    members = await select_conversation_members(signal.conversation_id)
    participant_ids = [member.user_id for member in members]
    if len(participant_ids) != 2 or current_user_id not in participant_ids:
        await _send_error(
            websocket,
            "unsupported_conversation",
            "Only one-to-one calls are supported",
        )
        return None

    lock_key = f"call:conversation:{signal.conversation_id}:active"
    lock_acquired = await _acquire_call_lock(signal.conversation_id)
    if not lock_acquired:
        await _send_error(websocket, "busy", "This conversation already has a call")
        return None

    try:
        call_id = await insert_call(signal.conversation_id, current_user_id)
        await redis_client.set(lock_key, str(call_id), ex=CALL_LOCK_SECONDS)
        recipient_id = next(
            participant_id
            for participant_id in participant_ids
            if participant_id != current_user_id
        )
        await _publish(
            recipient_id,
            {
                "type": "call.incoming",
                "call_id": call_id,
                "conversation_id": signal.conversation_id,
                "from_user_id": current_user_id,
                "media": signal.media,
                "offer": signal.offer.model_dump(),
            },
        )
        await websocket.send_json(
            {
                "type": "call.started",
                "call_id": call_id,
                "conversation_id": signal.conversation_id,
                "media": signal.media,
            }
        )
        return call_id
    except Exception:
        await redis_client.delete(lock_key)
        raise


async def _handle_accept(
    current_user_id: int,
    signal: AcceptCall,
    websocket: WebSocket,
) -> bool:
    if signal.answer.type != "answer":
        await _send_error(websocket, "invalid_answer", "Expected an SDP answer")
        return False
    call, recipient_id = await _resolve_call(current_user_id, signal.call_id)
    if call is None or recipient_id is None or call.caller_id == current_user_id:
        await _send_error(websocket, "call_not_found", "Call is not available")
        return False
    active_call = await redis_client.get(
        f"call:conversation:{call.conversation_id}:active"
    )
    if active_call is None or active_call.decode() != str(call.id):
        await _send_error(websocket, "call_expired", "Call has expired")
        return False
    updated = await transition_call_status(
        call.id,
        [CallsStatus.PENDING],
        CallsStatus.COMING,
    )
    if updated is None:
        await _send_error(websocket, "invalid_state", "Call is no longer ringing")
        return False
    await redis_client.expire(
        f"call:conversation:{call.conversation_id}:active",
        ACTIVE_CALL_LOCK_SECONDS,
    )
    await _publish(
        recipient_id,
        {
            "type": "call.accepted",
            "call_id": call.id,
            "answer": signal.answer.model_dump(),
        },
    )
    return True


async def _handle_candidate(
    current_user_id: int,
    signal: CallCandidate,
    websocket: WebSocket,
) -> None:
    call, recipient_id = await _resolve_call(current_user_id, signal.call_id)
    if call is None or recipient_id is None:
        await _send_error(websocket, "call_not_found", "Call is not available")
        return
    active_call = await redis_client.get(
        f"call:conversation:{call.conversation_id}:active"
    )
    if active_call is None or active_call.decode() != str(call.id):
        await _send_error(websocket, "call_expired", "Call has expired")
        return
    await _publish(
        recipient_id,
        {
            "type": "call.candidate",
            "call_id": call.id,
            "candidate": signal.candidate.model_dump(),
        },
    )


async def _handle_heartbeat(
    current_user_id: int,
    signal: CallHeartbeat,
    websocket: WebSocket,
) -> None:
    if await _is_group_call(signal.call_id):
        call = await _resolve_group_call(current_user_id, signal.call_id)
        if call is None:
            await _send_error(websocket, "call_not_found", "Group call is not active")
            return
        await _refresh_group_call(call.id, call.conversation_id)
        return
    call, _ = await _resolve_call(current_user_id, signal.call_id)
    if call is None or call.status != CallsStatus.COMING:
        await _send_error(websocket, "call_not_found", "Call is not active")
        return
    lock_key = f"call:conversation:{call.conversation_id}:active"
    active_call = await redis_client.get(lock_key)
    if active_call is None or active_call.decode() != str(call.id):
        await _send_error(websocket, "call_expired", "Call has expired")
        return
    await redis_client.expire(lock_key, ACTIVE_CALL_LOCK_SECONDS)


async def _handle_media_state(
    current_user_id: int,
    signal: CallMediaState,
    websocket: WebSocket,
) -> None:
    call, recipient_id = await _resolve_call(current_user_id, signal.call_id)
    if (
        call is None
        or recipient_id is None
        or call.status != CallsStatus.COMING
    ):
        await _send_error(websocket, "call_not_found", "Call is not active")
        return
    await _publish(
        recipient_id,
        {
            "type": "call.media_state",
            "call_id": call.id,
            "screen_sharing": signal.screen_sharing,
            "screen_audio": signal.screen_audio,
            "microphone_muted": signal.microphone_muted,
        },
    )


async def _resolve_group_call(
    current_user_id: int,
    call_id: int,
    *,
    require_joined: bool = True,
) -> object | None:
    call, conversation_member_ids = await select_call_participants(call_id)
    if (
        call is None
        or current_user_id not in conversation_member_ids
        or not await _is_group_call(call_id)
        or call.status != CallsStatus.COMING
    ):
        return None
    active_call = await redis_client.get(
        f"call:conversation:{call.conversation_id}:active"
    )
    if active_call is None or active_call.decode() != str(call.id):
        return None
    if require_joined and current_user_id not in await _group_participants(call_id):
        return None
    return call


async def _handle_group_start(
    current_user_id: int,
    signal: StartGroupCall,
    websocket: WebSocket,
) -> int | None:
    await validate_user_in_group(current_user_id, signal.conversation_id)
    members = await select_conversation_members(signal.conversation_id)
    participant_ids = [member.user_id for member in members]
    if len(participant_ids) < 2:
        await _send_error(
            websocket,
            "not_enough_participants",
            "Add at least one participant before starting a group call",
        )
        return None
    if len(participant_ids) > GROUP_CALL_MAX_PARTICIPANTS:
        await _send_error(
            websocket,
            "group_too_large",
            f"Group calls support up to {GROUP_CALL_MAX_PARTICIPANTS} participants",
        )
        return None

    # A member may have missed the one-shot invitation, reloaded the page, or
    # temporarily lost the signaling socket. In that case the regular call
    # button must join the active room instead of trying to create another one.
    active_group_call_id = await _active_group_call_id(signal.conversation_id)
    if active_group_call_id is not None:
        joined = await _handle_group_join(
            current_user_id,
            JoinGroupCall(type="call.group_join", call_id=active_group_call_id),
            websocket,
        )
        return active_group_call_id if joined else None

    if not await _acquire_call_lock(signal.conversation_id):
        await _send_error(websocket, "busy", "This conversation already has a call")
        return None

    lock_key = f"call:conversation:{signal.conversation_id}:active"
    try:
        call_id = await insert_call(signal.conversation_id, current_user_id)
        await redis_client.set(lock_key, str(call_id), ex=ACTIVE_CALL_LOCK_SECONDS)
        await redis_client.set(
            _group_key(call_id),
            "1",
            ex=GROUP_CALL_TTL_SECONDS,
        )
        await redis_client.sadd(_group_participants_key(call_id), current_user_id)
        await redis_client.expire(
            _group_participants_key(call_id),
            GROUP_CALL_TTL_SECONDS,
        )
        updated = await transition_call_status(
            call_id,
            [CallsStatus.PENDING],
            CallsStatus.COMING,
        )
        if updated is None:
            raise RuntimeError("Unable to activate group call")

        incoming_payload = {
            "type": "call.group_incoming",
            "call_id": call_id,
            "conversation_id": signal.conversation_id,
            "from_user_id": current_user_id,
            "media": signal.media,
        }
        for participant_id in participant_ids:
            if participant_id != current_user_id:
                await _publish(participant_id, incoming_payload)
        await websocket.send_json(
            {
                "type": "call.group_started",
                "call_id": call_id,
                "conversation_id": signal.conversation_id,
                "media": signal.media,
                "max_participants": GROUP_CALL_MAX_PARTICIPANTS,
            }
        )
        return call_id
    except Exception:
        await redis_client.delete(
            lock_key,
            _group_key(locals().get("call_id", 0)),
            _group_participants_key(locals().get("call_id", 0)),
        )
        raise


async def _handle_group_join(
    current_user_id: int,
    signal: JoinGroupCall,
    websocket: WebSocket,
) -> bool:
    call = await _resolve_group_call(
        current_user_id,
        signal.call_id,
        require_joined=False,
    )
    if call is None:
        await _send_error(websocket, "call_not_found", "Group call is not available")
        return False
    participants = await _group_participants(call.id)
    already_joined = current_user_id in participants
    if not already_joined and len(participants) >= GROUP_CALL_MAX_PARTICIPANTS:
        await _send_error(websocket, "call_full", "The group call is full")
        return False
    existing = sorted(participants - {current_user_id})
    if not already_joined:
        await redis_client.sadd(_group_participants_key(call.id), current_user_id)
    await _refresh_group_call(call.id, call.conversation_id)
    await websocket.send_json(
        {
            "type": "call.group_joined",
            "call_id": call.id,
            "participant_ids": existing,
        }
    )
    if not already_joined:
        for participant_id in existing:
            await _publish(
                participant_id,
                {
                    "type": "call.group_peer_joined",
                    "call_id": call.id,
                    "user_id": current_user_id,
                },
            )
    return True


async def _handle_group_relay(
    current_user_id: int,
    signal: GroupCallOffer | GroupCallAnswer | GroupCallCandidate,
    websocket: WebSocket,
) -> None:
    call = await _resolve_group_call(current_user_id, signal.call_id)
    participants = await _group_participants(signal.call_id)
    if (
        call is None
        or signal.target_user_id == current_user_id
        or signal.target_user_id not in participants
    ):
        await _send_error(websocket, "call_not_found", "Group peer is not available")
        return
    payload: dict = {
        "type": signal.type,
        "call_id": call.id,
        "from_user_id": current_user_id,
    }
    if isinstance(signal, GroupCallOffer):
        payload["offer"] = signal.offer.model_dump()
    elif isinstance(signal, GroupCallAnswer):
        payload["answer"] = signal.answer.model_dump()
    else:
        payload["candidate"] = signal.candidate.model_dump()
    await _refresh_group_call(call.id, call.conversation_id)
    await _publish(signal.target_user_id, payload)


async def _handle_group_media_state(
    current_user_id: int,
    signal: GroupCallMediaState,
    websocket: WebSocket,
) -> None:
    call = await _resolve_group_call(current_user_id, signal.call_id)
    if call is None:
        await _send_error(websocket, "call_not_found", "Group call is not active")
        return
    participants = await _group_participants(call.id)
    await _refresh_group_call(call.id, call.conversation_id)
    for participant_id in participants - {current_user_id}:
        await _publish(
            participant_id,
            {
                "type": "call.group_media_state",
                "call_id": call.id,
                "from_user_id": current_user_id,
                "screen_sharing": signal.screen_sharing,
                "screen_audio": signal.screen_audio,
                "microphone_muted": signal.microphone_muted,
            },
        )


async def _leave_group_call(current_user_id: int, call_id: int) -> bool:
    call = await _resolve_group_call(
        current_user_id,
        call_id,
        require_joined=False,
    )
    if call is None:
        return False
    participants = await _group_participants(call.id)
    was_joined = current_user_id in participants
    if was_joined:
        await redis_client.srem(_group_participants_key(call.id), current_user_id)
    remaining = participants - {current_user_id}
    if was_joined:
        for participant_id in remaining:
            await _publish(
                participant_id,
                {
                    "type": "call.group_peer_left",
                    "call_id": call.id,
                    "user_id": current_user_id,
                },
            )
    if not remaining:
        updated = await transition_call_status(
            call.id,
            [CallsStatus.COMING],
            CallsStatus.COMPLETED,
        )
        await _release_call_lock(call.conversation_id, call.id)
        await redis_client.delete(
            _group_key(call.id),
            _group_participants_key(call.id),
        )
        if updated is not None:
            await _record_call_history(updated, "completed")
    else:
        await _refresh_group_call(call.id, call.conversation_id)
    return was_joined


async def _handle_group_leave(
    current_user_id: int,
    signal: LeaveGroupCall,
    websocket: WebSocket,
) -> bool:
    if not await _leave_group_call(current_user_id, signal.call_id):
        # Declining an invitation before joining is intentionally idempotent.
        if not await _is_group_call(signal.call_id):
            await _send_error(websocket, "call_not_found", "Group call is not active")
            return False
    await websocket.send_json(
        {"type": "call.group_left", "call_id": signal.call_id}
    )
    return True


async def _handle_action(
    current_user_id: int,
    signal: CallAction,
    websocket: WebSocket,
) -> bool:
    call, recipient_id = await _resolve_call(current_user_id, signal.call_id)
    if call is None or recipient_id is None:
        await _send_error(websocket, "call_not_found", "Call is not available")
        return False

    if signal.type == "call.reject":
        valid_actor = call.caller_id != current_user_id
        from_statuses = [CallsStatus.PENDING]
        to_status = CallsStatus.MISSED
    elif signal.type == "call.cancel":
        valid_actor = call.caller_id == current_user_id
        from_statuses = [CallsStatus.PENDING]
        to_status = CallsStatus.MISSED
    else:
        valid_actor = True
        from_statuses = [CallsStatus.PENDING, CallsStatus.COMING]
        to_status = CallsStatus.COMPLETED

    if not valid_actor:
        await _send_error(websocket, "forbidden_action", "Action is not allowed")
        return False
    updated = await transition_call_status(call.id, from_statuses, to_status)
    if updated is None:
        await _send_error(websocket, "invalid_state", "Call is already finished")
        return False
    await _release_call_lock(call.conversation_id, call.id)
    await _record_call_history(
        updated,
        {
            "call.reject": "rejected",
            "call.cancel": "cancelled",
            "call.end": "completed",
        }[signal.type],
    )
    await _publish(
        recipient_id,
        {"type": signal.type, "call_id": call.id},
    )
    return True


async def disconnect_call(current_user_id: int, call_id: int) -> bool:
    """Finish a call when the browser page is being unloaded.

    The operation is intentionally idempotent because the WebSocket frame and
    the keepalive HTTP request can race each other during a page refresh.
    """
    if await _is_group_call(call_id):
        return await _leave_group_call(current_user_id, call_id)

    call, recipient_id = await _resolve_call(current_user_id, call_id)
    if call is None or recipient_id is None:
        return False

    if call.status == CallsStatus.PENDING:
        from_statuses = [CallsStatus.PENDING]
        to_status = CallsStatus.MISSED
    elif call.status == CallsStatus.COMING:
        from_statuses = [CallsStatus.COMING]
        to_status = CallsStatus.COMPLETED
    else:
        await _release_call_lock(call.conversation_id, call.id)
        return False

    updated = await transition_call_status(call.id, from_statuses, to_status)
    await _release_call_lock(call.conversation_id, call.id)
    if updated is None:
        return False
    await _record_call_history(
        updated,
        "missed" if to_status == CallsStatus.MISSED else "completed",
    )
    await _publish(
        recipient_id,
        {"type": "call.end", "call_id": call.id, "reason": "peer_disconnected"},
    )
    return True


async def handle_call_signal(
    current_user_id: int,
    payload: object,
    websocket: WebSocket,
    active_call_ids: set[int] | None = None,
) -> None:
    try:
        signal = parse_call_signal(payload)
    except ValidationError as exc:
        await _send_error(
            websocket,
            "invalid_signal",
            exc.errors(include_url=False)[0]["msg"],
        )
        return

    try:
        if isinstance(signal, StartGroupCall):
            call_id = await _handle_group_start(current_user_id, signal, websocket)
            if call_id is not None and active_call_ids is not None:
                active_call_ids.add(call_id)
        elif isinstance(signal, JoinGroupCall):
            joined = await _handle_group_join(current_user_id, signal, websocket)
            if joined and active_call_ids is not None:
                active_call_ids.add(signal.call_id)
        elif isinstance(
            signal,
            (GroupCallOffer, GroupCallAnswer, GroupCallCandidate),
        ):
            await _handle_group_relay(current_user_id, signal, websocket)
        elif isinstance(signal, GroupCallMediaState):
            await _handle_group_media_state(current_user_id, signal, websocket)
        elif isinstance(signal, LeaveGroupCall):
            left = await _handle_group_leave(current_user_id, signal, websocket)
            if left and active_call_ids is not None:
                active_call_ids.discard(signal.call_id)
        elif isinstance(signal, StartCall):
            call_id = await _handle_start(current_user_id, signal, websocket)
            if call_id is not None and active_call_ids is not None:
                active_call_ids.add(call_id)
        elif isinstance(signal, AcceptCall):
            accepted = await _handle_accept(current_user_id, signal, websocket)
            if accepted and active_call_ids is not None:
                active_call_ids.add(signal.call_id)
        elif isinstance(signal, CallCandidate):
            await _handle_candidate(current_user_id, signal, websocket)
        elif isinstance(signal, CallHeartbeat):
            await _handle_heartbeat(current_user_id, signal, websocket)
        elif isinstance(signal, CallMediaState):
            await _handle_media_state(current_user_id, signal, websocket)
        else:
            finished = await _handle_action(current_user_id, signal, websocket)
            if finished and active_call_ids is not None:
                active_call_ids.discard(signal.call_id)
    except (
        ConversationNotFoundError,
        IsNotAChatError,
        IsNotAGroupError,
        UserNotInConversation,
    ):
        await _send_error(
            websocket,
            "forbidden_conversation",
            "Conversation is not available",
        )
    except Exception:
        logger.exception(
            "Unexpected call signaling failure",
            extra={"user_id": current_user_id, "signal_type": signal.type},
        )
        await _send_error(
            websocket,
            "internal_error",
            "The call server could not process this request",
        )


async def calls_listener(current_user_id: int, websocket: WebSocket) -> None:
    pubsub = redis_client.pubsub()
    channel = f"user:call_events:{current_user_id}"
    active_call_ids: set[int] = set()
    await pubsub.subscribe(channel)

    async def receive_signals() -> None:
        while True:
            payload = await websocket.receive_json()
            await handle_call_signal(
                current_user_id,
                payload,
                websocket,
                active_call_ids,
            )

    async def forward_signals() -> None:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            payload = json.loads(message["data"].decode())
            if payload.get("type") in {
                "call.reject",
                "call.cancel",
                "call.end",
            }:
                active_call_ids.discard(int(payload["call_id"]))
            await websocket.send_json(payload)

    import asyncio

    receiver = asyncio.create_task(receive_signals())
    forwarder = asyncio.create_task(forward_signals())
    try:
        _, pending = await asyncio.wait(
            {receiver, forwarder},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        await asyncio.gather(receiver, forwarder, return_exceptions=True)
    finally:
        cleanup_call_ids = tuple(active_call_ids)
        cleanup_results = await asyncio.gather(
            *(
                disconnect_call(current_user_id, call_id)
                for call_id in cleanup_call_ids
            ),
            return_exceptions=True,
        )
        for call_id, result in zip(cleanup_call_ids, cleanup_results):
            if isinstance(result, Exception):
                logger.error(
                    "Unable to clean up call %s after signaling disconnect: %r",
                    call_id,
                    result,
                )
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
