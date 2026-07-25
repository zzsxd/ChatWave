import re
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


DEVICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
EVENT_TYPE_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,255}$")
TRANSACTION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._~-]{1,128}$")

JsonObject = dict[str, Any]


class E2EEModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KeysUpload(E2EEModel):
    device_keys: JsonObject | None = None
    one_time_keys: dict[str, JsonObject] = Field(default_factory=dict)
    fallback_keys: dict[str, JsonObject] = Field(default_factory=dict)

    @field_validator("one_time_keys", "fallback_keys")
    @classmethod
    def limit_keys(cls, value: dict[str, JsonObject]) -> dict[str, JsonObject]:
        if len(value) > 512:
            raise ValueError("Too many keys in one request")
        for key_id in value:
            if len(key_id) > 255 or ":" not in key_id:
                raise ValueError("Invalid key id")
        return value


class KeysQuery(E2EEModel):
    device_keys: dict[str, list[str]] = Field(min_length=1, max_length=256)
    timeout: Annotated[int | None, Field(default=None, ge=0, le=120_000)]
    token: Annotated[str | None, Field(default=None, max_length=512)]

    @field_validator("device_keys")
    @classmethod
    def limit_devices(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        if sum(len(device_ids) for device_ids in value.values()) > 1024:
            raise ValueError("Too many devices in one request")
        for device_ids in value.values():
            if any(not DEVICE_ID_PATTERN.fullmatch(item) for item in device_ids):
                raise ValueError("Invalid device id")
        return value


class KeysClaim(E2EEModel):
    one_time_keys: dict[str, dict[str, str]] = Field(
        min_length=1,
        max_length=256,
    )
    timeout: Annotated[int | None, Field(default=None, ge=0, le=120_000)]

    @field_validator("one_time_keys")
    @classmethod
    def limit_claims(
        cls,
        value: dict[str, dict[str, str]],
    ) -> dict[str, dict[str, str]]:
        if sum(len(device_map) for device_map in value.values()) > 1024:
            raise ValueError("Too many key claims in one request")
        for device_map in value.values():
            for device_id, algorithm in device_map.items():
                if not DEVICE_ID_PATTERN.fullmatch(device_id):
                    raise ValueError("Invalid device id")
                if not EVENT_TYPE_PATTERN.fullmatch(algorithm):
                    raise ValueError("Invalid key algorithm")
        return value


class ToDeviceMessages(E2EEModel):
    messages: dict[str, dict[str, JsonObject]] = Field(
        min_length=1,
        max_length=256,
    )

    @field_validator("messages")
    @classmethod
    def limit_messages(
        cls,
        value: dict[str, dict[str, JsonObject]],
    ) -> dict[str, dict[str, JsonObject]]:
        if sum(len(device_map) for device_map in value.values()) > 2048:
            raise ValueError("Too many to-device messages")
        for device_map in value.values():
            for device_id in device_map:
                if device_id != "*" and not DEVICE_ID_PATTERN.fullmatch(device_id):
                    raise ValueError("Invalid device id")
        return value


class KeyBackup(E2EEModel):
    version: Annotated[int, Field(default=1, ge=1, le=2_147_483_647)]
    encrypted_data: Annotated[str, Field(min_length=1, max_length=16_777_216)]


DeviceId = Annotated[str, Field(pattern=DEVICE_ID_PATTERN.pattern)]
DeviceSecret = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{43}$")]
EventType = Annotated[str, Field(pattern=EVENT_TYPE_PATTERN.pattern)]
TransactionId = Annotated[str, Field(pattern=TRANSACTION_ID_PATTERN.pattern)]
