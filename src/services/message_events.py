import asyncio
import json
import logging
import time
from typing import Literal

from fastapi import WebSocket
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.websockets import WebSocketDisconnect

from dependencies import redis_client
from repository import (
    mark_message_receipts_delivered,
    mark_message_receipts_read,
    select_conversation_members,
    select_message,
    select_message_receipts_statuses,
    select_messages,
    select_receipts_for_messages,
)
from schemas import GetMessage
from utilities import MessagesStatus
from validators import validate_user_in_conversation


logger = logging.getLogger(__name__)
MAX_CLIENT_SIGNALS_PER_10_SECONDS = 40


class TypingSignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["typing.start", "typing.stop"]
    conversation_id: int = Field(ge=1, le=2_147_483_647)


class ReceiptSignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["message.delivered", "message.read"]
    message_id: int = Field(ge=1, le=2_147_483_647)


class ReceiptBatchSignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["message.delivered_batch", "message.read_batch"]
    conversation_id: int = Field(ge=1, le=2_147_483_647)
    message_ids: list[int] = Field(min_length=1, max_length=500)


async def _publish_to_members(
    conversation_id: int,
    payload: dict,
    exclude_user_id: int | None = None,
) -> None:
    members = await select_conversation_members(conversation_id)
    serialized = json.dumps(payload, separators=(",", ":"))
    for member in members:
        if member.user_id == exclude_user_id:
            continue
        await redis_client.publish(
            f"user:message_events:{member.user_id}",
            serialized,
        )


async def _publish_committed(conversation_id: int, payload: dict) -> None:
    """Publish after a transaction without making Redis part of that transaction."""
    try:
        await _publish_to_members(conversation_id, payload)
    except Exception:
        logger.exception(
            "Unable to publish committed message event for conversation %s",
            conversation_id,
        )


async def publish_message_created(message: GetMessage) -> None:
    await _publish_committed(
        message.conversation_id,
        {
            "type": "message.created",
            "message": message.model_dump(mode="json"),
        },
    )


async def publish_message_updated(message: GetMessage) -> None:
    await _publish_committed(
        message.conversation_id,
        {
            "type": "message.updated",
            "message": message.model_dump(mode="json"),
        },
    )


async def publish_messages_deleted(
    messages_by_conversation: dict[int, list[int]],
) -> None:
    for conversation_id, message_ids in messages_by_conversation.items():
        await _publish_committed(
            conversation_id,
            {
                "type": "message.deleted",
                "conversation_id": conversation_id,
                "message_ids": message_ids,
            },
        )


async def publish_message_status(
    conversation_id: int,
    message_id: int,
    status: MessagesStatus,
) -> None:
    await _publish_committed(
        conversation_id,
        {
            "type": "message.status",
            "conversation_id": conversation_id,
            "message_id": message_id,
            "status": status.value,
        },
    )


async def publish_message_statuses(
    conversation_id: int,
    statuses: list[dict],
) -> None:
    if not statuses:
        return
    await _publish_committed(
        conversation_id,
        {
            "type": "message.statuses",
            "conversation_id": conversation_id,
            "statuses": statuses,
        },
    )


def _effective_status(statuses: list[MessagesStatus]) -> MessagesStatus:
    if not statuses:
        return MessagesStatus.SENT
    if all(status == MessagesStatus.READ for status in statuses):
        return MessagesStatus.READ
    if all(
        status in (MessagesStatus.DELIVERED, MessagesStatus.READ)
        for status in statuses
    ):
        return MessagesStatus.DELIVERED
    return MessagesStatus.SENT


async def _handle_receipt(
    current_user_id: int,
    signal: ReceiptSignal,
    websocket: WebSocket,
) -> None:
    message = await select_message(signal.message_id)
    if message is None:
        await websocket.send_json(
            {"type": "message.error", "code": "message_not_found"}
        )
        return
    await validate_user_in_conversation(
        user_id=current_user_id,
        conversation_id=message.conversation_id,
    )
    if message.sender_id == current_user_id:
        return

    if signal.type == "message.read":
        await mark_message_receipts_read(current_user_id, [message.id])
    else:
        await mark_message_receipts_delivered(current_user_id, [message.id])

    statuses = await select_message_receipts_statuses(message.id)
    await _publish_to_members(
        message.conversation_id,
        {
            "type": "message.status",
            "conversation_id": message.conversation_id,
            "message_id": message.id,
            "status": _effective_status(statuses).value,
        },
    )


async def _handle_receipt_batch(
    current_user_id: int,
    signal: ReceiptBatchSignal,
) -> None:
    await validate_user_in_conversation(
        user_id=current_user_id,
        conversation_id=signal.conversation_id,
    )
    unique_ids = list(dict.fromkeys(signal.message_ids))
    messages = list(await select_messages(unique_ids))
    valid_ids = [
        message.id
        for message in messages
        if (
            message.conversation_id == signal.conversation_id
            and message.sender_id != current_user_id
        )
    ]
    if not valid_ids:
        return

    if signal.type == "message.read_batch":
        await mark_message_receipts_read(current_user_id, valid_ids)
    else:
        await mark_message_receipts_delivered(current_user_id, valid_ids)

    receipt_rows = await select_receipts_for_messages(valid_ids)
    statuses_by_message: dict[int, list[MessagesStatus]] = {}
    for message_id, _recipient_id, receipt_status in receipt_rows:
        statuses_by_message.setdefault(message_id, []).append(receipt_status)
    await _publish_to_members(
        signal.conversation_id,
        {
            "type": "message.statuses",
            "conversation_id": signal.conversation_id,
            "statuses": [
                {
                    "message_id": message_id,
                    "status": _effective_status(
                        statuses_by_message.get(message_id, [])
                    ).value,
                }
                for message_id in valid_ids
            ],
        },
    )


async def _handle_typing(
    current_user_id: int,
    signal: TypingSignal,
) -> None:
    await validate_user_in_conversation(
        user_id=current_user_id,
        conversation_id=signal.conversation_id,
    )
    typing_key = f"typing:{signal.conversation_id}:{current_user_id}"
    if signal.type == "typing.start":
        should_publish = await redis_client.set(
            typing_key,
            "1",
            ex=5,
            nx=True,
        )
        if not should_publish:
            return
    else:
        await redis_client.delete(typing_key)

    await _publish_to_members(
        signal.conversation_id,
        {
            "type": signal.type,
            "conversation_id": signal.conversation_id,
            "user_id": current_user_id,
        },
        exclude_user_id=current_user_id,
    )


async def _handle_client_signal(
    current_user_id: int,
    payload: object,
    websocket: WebSocket,
) -> None:
    try:
        bucket = int(time.time()) // 10
        rate_key = f"rate:message_signals:{current_user_id}:{bucket}"
        signal_count = await redis_client.incr(rate_key)
        if signal_count == 1:
            await redis_client.expire(rate_key, 11)
        if signal_count > MAX_CLIENT_SIGNALS_PER_10_SECONDS:
            await websocket.send_json(
                {"type": "message.error", "code": "rate_limited"}
            )
            return
        signal_type = (
            str(payload.get("type", ""))
            if isinstance(payload, dict)
            else ""
        )
        if signal_type.startswith("typing."):
            await _handle_typing(
                current_user_id,
                TypingSignal.model_validate(payload),
            )
        elif signal_type.endswith("_batch"):
            await _handle_receipt_batch(
                current_user_id,
                ReceiptBatchSignal.model_validate(payload),
            )
        else:
            await _handle_receipt(
                current_user_id,
                ReceiptSignal.model_validate(payload),
                websocket,
            )
    except ValidationError:
        await websocket.send_json(
            {"type": "message.error", "code": "invalid_signal"}
        )
    except Exception as exc:
        logger.warning("Rejected message signal: %s", exc)
        await websocket.send_json(
            {"type": "message.error", "code": "forbidden_signal"}
        )


async def message_events_listener(
    current_user_id: int,
    websocket: WebSocket,
) -> None:
    pubsub = redis_client.pubsub()
    channel = f"user:message_events:{current_user_id}"
    await pubsub.subscribe(channel)

    async def receive_signals() -> None:
        while True:
            await _handle_client_signal(
                current_user_id,
                await websocket.receive_json(),
                websocket,
            )

    async def forward_events() -> None:
        async for event in pubsub.listen():
            if event["type"] != "message":
                continue
            await websocket.send_json(json.loads(event["data"].decode()))

    receiver = asyncio.create_task(receive_signals())
    forwarder = asyncio.create_task(forward_events())
    try:
        _, pending = await asyncio.wait(
            {receiver, forwarder},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
    except WebSocketDisconnect:
        pass
    finally:
        receiver.cancel()
        forwarder.cancel()
        await asyncio.gather(receiver, forwarder, return_exceptions=True)
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
