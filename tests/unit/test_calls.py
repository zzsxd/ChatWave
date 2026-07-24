import base64
import hashlib
import hmac

import pytest
from pydantic import ValidationError

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
        }
    )
    assert isinstance(signal, CallMediaState)
    assert signal.screen_sharing is True
    assert signal.screen_audio is True


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
