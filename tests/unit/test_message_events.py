import json
from types import SimpleNamespace

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
