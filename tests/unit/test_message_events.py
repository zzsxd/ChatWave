import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from schemas import GetMessage
from services import message_events
from utilities import MessagesStatus, MessagesTypes


def make_message() -> GetMessage:
    return GetMessage(
        id=91,
        conversation_id=12,
        sender_id=4,
        status=MessagesStatus.SENT,
        type=MessagesTypes.TEXT,
        content="Привет",
        file_content_name=None,
        file_content_type=None,
        file_size=None,
        created_at=None,
        updated_at=None,
    )


async def test_publish_message_created_to_every_conversation_member(monkeypatch):
    published = []

    async def select_members(_conversation_id):
        return [SimpleNamespace(user_id=4), SimpleNamespace(user_id=7)]

    async def publish(channel, payload):
        published.append((channel, json.loads(payload)))

    monkeypatch.setattr(message_events, "select_conversation_members", select_members)
    monkeypatch.setattr(message_events.redis_client, "publish", publish)

    await message_events.publish_message_created(make_message())

    assert [channel for channel, _ in published] == [
        "user:message_events:4",
        "user:message_events:7",
    ]
    assert published[0][1]["type"] == "message.created"
    assert published[0][1]["message"]["id"] == 91


async def test_realtime_failure_does_not_fail_committed_message(monkeypatch):
    async def select_members(_conversation_id):
        raise ConnectionError("Redis is unavailable")

    monkeypatch.setattr(message_events, "select_conversation_members", select_members)

    await message_events.publish_message_created(make_message())


def test_typing_signal_rejects_unknown_fields_and_invalid_conversations():
    with pytest.raises(ValidationError):
        message_events.TypingSignal.model_validate(
            {
                "type": "typing.start",
                "conversation_id": 0,
                "user_id": 999,
            }
        )


@pytest.mark.parametrize(
    ("statuses", "expected"),
    [
        ([], MessagesStatus.SENT),
        ([MessagesStatus.SENT, MessagesStatus.READ], MessagesStatus.SENT),
        (
            [MessagesStatus.DELIVERED, MessagesStatus.READ],
            MessagesStatus.DELIVERED,
        ),
        ([MessagesStatus.READ, MessagesStatus.READ], MessagesStatus.READ),
    ],
)
def test_effective_status_requires_all_recipients(statuses, expected):
    assert message_events._effective_status(statuses) == expected


async def test_read_batch_marks_messages_and_publishes_one_status_event(
    monkeypatch,
):
    mark_read = AsyncMock()
    publish = AsyncMock()
    monkeypatch.setattr(
        message_events,
        "validate_user_in_conversation",
        AsyncMock(),
    )
    monkeypatch.setattr(
        message_events,
        "select_messages",
        AsyncMock(
            return_value=[
                SimpleNamespace(id=91, conversation_id=12, sender_id=4),
                SimpleNamespace(id=92, conversation_id=12, sender_id=7),
                SimpleNamespace(id=93, conversation_id=99, sender_id=4),
            ]
        ),
    )
    monkeypatch.setattr(message_events, "mark_message_receipts_read", mark_read)
    monkeypatch.setattr(
        message_events,
        "select_receipts_for_messages",
        AsyncMock(
            return_value=[
                (91, 7, MessagesStatus.READ),
                (92, 4, MessagesStatus.READ),
            ]
        ),
    )
    monkeypatch.setattr(message_events, "_publish_to_members", publish)

    await message_events._handle_receipt_batch(
        11,
        message_events.ReceiptBatchSignal(
            type="message.read_batch",
            conversation_id=12,
            message_ids=[91, 92, 93, 91],
        ),
    )

    mark_read.assert_awaited_once_with(11, [91, 92])
    publish.assert_awaited_once()
    assert publish.await_args.args[1] == {
        "type": "message.statuses",
        "conversation_id": 12,
        "statuses": [
            {"message_id": 91, "status": MessagesStatus.READ.value},
            {"message_id": 92, "status": MessagesStatus.READ.value},
        ],
    }
