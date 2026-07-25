from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from routes import e2ee as e2ee_routes
from schemas.e2ee import KeysClaim, KeysQuery, KeysUpload, ToDeviceMessages


def device_keys(user_id: int = 7, device_id: str = "DEVICE_1") -> dict:
    crypto_user_id = e2ee_routes.matrix_user_id(user_id)
    return {
        "user_id": crypto_user_id,
        "device_id": device_id,
        "algorithms": ["m.olm.v1.curve25519-aes-sha2"],
        "keys": {
            f"curve25519:{device_id}": "curve-key",
            f"ed25519:{device_id}": "signing-key",
        },
        "signatures": {
            crypto_user_id: {
                f"ed25519:{device_id}": "signature",
            }
        },
    }


def test_matrix_user_id_round_trip():
    assert e2ee_routes.matrix_user_id(42) == "@user-42:chatwave.local"
    assert e2ee_routes.parse_matrix_user_id("@user-42:chatwave.local") == 42


@pytest.mark.parametrize(
    "value",
    [
        "@user-0:chatwave.local",
        "@user--1:chatwave.local",
        "@user-1:other.local",
        "@admin:chatwave.local",
        "@user-2147483648:chatwave.local",
    ],
)
def test_parse_matrix_user_id_rejects_untrusted_names(value):
    with pytest.raises(HTTPException) as error:
        e2ee_routes.parse_matrix_user_id(value)
    assert error.value.status_code == 400


def test_validate_device_keys_requires_authenticated_identity_and_signature():
    e2ee_routes.validate_own_device_keys(7, "DEVICE_1", device_keys())

    wrong_user = device_keys()
    wrong_user["user_id"] = "@user-8:chatwave.local"
    with pytest.raises(HTTPException):
        e2ee_routes.validate_own_device_keys(7, "DEVICE_1", wrong_user)

    unsigned = device_keys()
    unsigned["signatures"] = {}
    with pytest.raises(HTTPException):
        e2ee_routes.validate_own_device_keys(7, "DEVICE_1", unsigned)


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (KeysUpload, {"one_time_keys": {"missing-colon": {"key": "x"}}}),
        (KeysQuery, {"device_keys": {"@user-1:chatwave.local": ["bad id"]}}),
        (
            KeysClaim,
            {
                "one_time_keys": {
                    "@user-1:chatwave.local": {"bad id": "signed_curve25519"}
                }
            },
        ),
        (
            ToDeviceMessages,
            {"messages": {"@user-1:chatwave.local": {"bad id": {}}}},
        ),
    ],
)
def test_e2ee_schemas_reject_invalid_identifiers(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.asyncio
async def test_reachable_users_rejects_non_contacts(monkeypatch):
    reachable = AsyncMock(return_value={7})
    monkeypatch.setattr(e2ee_routes, "select_reachable_user_ids", reachable)

    with pytest.raises(HTTPException) as error:
        await e2ee_routes.require_reachable_users(
            7,
            ["@user-7:chatwave.local", "@user-8:chatwave.local"],
        )
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_sync_formats_opaque_events_and_authorized_device_list(monkeypatch):
    monkeypatch.setattr(
        e2ee_routes,
        "select_to_device_events",
        AsyncMock(
            return_value=(
                [
                    SimpleNamespace(
                        sender_user_id=8,
                        event_type="m.room.encrypted",
                        content={"ciphertext": {"opaque": "payload"}},
                    )
                ],
                19,
            )
        ),
    )
    monkeypatch.setattr(
        e2ee_routes,
        "select_shared_user_ids",
        AsyncMock(return_value={7, 8}),
    )
    monkeypatch.setattr(
        e2ee_routes,
        "select_one_time_key_counts",
        AsyncMock(return_value={"signed_curve25519": 24}),
    )

    response = await e2ee_routes.sync_to_device(
        current_user_id=7,
        device_id="DEVICE_1",
        device_secret="a" * 43,
        since=0,
        limit=100,
    )

    assert response["next_batch"] == "19"
    assert response["to_device"]["events"][0]["sender"] == (
        "@user-8:chatwave.local"
    )
    assert response["to_device"]["events"][0]["content"] == {
        "ciphertext": {"opaque": "payload"}
    }
    assert response["device_lists"]["changed"] == [
        "@user-7:chatwave.local",
        "@user-8:chatwave.local",
    ]
    assert response["device_one_time_keys_count"] == {
        "signed_curve25519": 24
    }
