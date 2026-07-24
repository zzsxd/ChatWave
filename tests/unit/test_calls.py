import asyncio
import base64
import hashlib
import hmac
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

import services.calls as calls_service
from routes.calls import build_ice_server_config
from schemas.calls import (
    AcceptCall,
    CallHeartbeat,
    CallMediaState,
    StartCall,
    parse_call_signal,
)
from utilities import generic_settings


def test_parse_start_call_signal():
    signal = parse_call_signal(
        {
            "type": "call.start",
            "conversation_id": 42,
            "media": "video",
            "offer": {"type": "offer", "sdp": "v=0"},
        }
    )
    assert isinstance(signal, StartCall)
    assert signal.conversation_id == 42


def test_parse_accept_call_signal():
    signal = parse_call_signal(
        {
            "type": "call.accept",
            "call_id": 7,
            "answer": {"type": "answer", "sdp": "v=0"},
        }
    )
    assert isinstance(signal, AcceptCall)


def test_parse_call_heartbeat_signal():
    signal = parse_call_signal({"type": "call.heartbeat", "call_id": 7})
    assert isinstance(signal, CallHeartbeat)


def test_parse_call_media_state_signal():
    signal = parse_call_signal(
        {
            "type": "call.media_state",
            "call_id": 7,
            "screen_sharing": True,
            "screen_audio": True,
            "microphone_muted": True,
        }
    )
    assert isinstance(signal, CallMediaState)
    assert signal.screen_sharing is True
    assert signal.screen_audio is True
    assert signal.microphone_muted is True


def test_build_ice_server_config_uses_short_lived_signed_credentials(monkeypatch):
    secret = "a-production-secret-that-is-long-enough"
    turn_urls = [
        "turn:chatwave.example:3478?transport=udp",
        "turn:chatwave.example:3478?transport=tcp",
    ]
    monkeypatch.setattr(generic_settings, "STUN_URLS", ["stun:chatwave.example:3478"])
    monkeypatch.setattr(generic_settings, "TURN_URLS", turn_urls)
    monkeypatch.setattr(generic_settings, "TURN_SHARED_SECRET", secret)
    monkeypatch.setattr(generic_settings, "TURN_CREDENTIAL_TTL_SECONDS", 3600)

    config = build_ice_server_config(user_id=17, now=1_700_000_000)

    username = "1700003600:17"
    expected_credential = base64.b64encode(
        hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    ).decode()
    assert config == {
        "ice_servers": [
            {"urls": ["stun:chatwave.example:3478"]},
            {
                "urls": turn_urls,
                "username": username,
                "credential": expected_credential,
            },
        ],
        "expires_at": 1_700_003_600,
    }
    assert secret not in str(config)


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "call.start", "conversation_id": 0, "media": "audio"},
        {
            "type": "call.start",
            "conversation_id": 1,
            "media": "screen",
            "offer": {"type": "offer", "sdp": "v=0"},
        },
        {
            "type": "call.accept",
            "call_id": 1,
            "answer": {"type": "offer", "sdp": "v=0"},
        },
        {"type": "call.candidate", "call_id": 1, "candidate": {"candidate": "x", "extra": "x"}},
        {"type": "call.hack", "call_id": 1},
    ],
)
def test_reject_invalid_call_signals(payload):
    with pytest.raises(ValidationError):
        parse_call_signal(payload)


async def test_successful_start_is_tracked_by_websocket_session(monkeypatch):
    tracked_calls: set[int] = set()
    start = AsyncMock(return_value=73)
    monkeypatch.setattr(calls_service, "_handle_start", start)

    await calls_service.handle_call_signal(
        11,
        {
            "type": "call.start",
            "conversation_id": 42,
            "media": "audio",
            "offer": {"type": "offer", "sdp": "v=0"},
        },
        AsyncMock(),
        tracked_calls,
    )

    assert tracked_calls == {73}


async def test_signaling_disconnect_cleans_up_tracked_calls(monkeypatch):
    class FakePubSub:
        async def subscribe(self, _channel):
            return None

        async def unsubscribe(self, _channel):
            return None

        async def aclose(self):
            return None

        async def listen(self):
            while True:
                await asyncio.sleep(60)
                yield {"type": "noop"}

    class FakeRedis:
        def pubsub(self):
            return FakePubSub()

    websocket = AsyncMock()
    websocket.receive_json.side_effect = [
        {"type": "call.heartbeat", "call_id": 91},
        RuntimeError("socket closed"),
    ]

    async def track_call(_user_id, _payload, _websocket, active_call_ids):
        active_call_ids.add(91)

    cleanup = AsyncMock(return_value=True)
    monkeypatch.setattr(calls_service, "redis_client", FakeRedis())
    monkeypatch.setattr(calls_service, "handle_call_signal", track_call)
    monkeypatch.setattr(calls_service, "disconnect_call", cleanup)

    await calls_service.calls_listener(11, websocket)

    cleanup.assert_awaited_once_with(11, 91)
