import json
from typing import Annotated, Any, Literal, Optional
from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from uuid import UUID

from utilities import MessagesStatus, MessagesTypes, request_limit


class MessagesIds(BaseModel):
    messages_ids: list[Annotated[int, Field(ge=1, le=2_147_483_647)]]

    @field_validator('messages_ids', mode='after')
    def set_limits(cls, values):
        values = request_limit(values)
        if not values:
            raise ValueError("At least one message id is required")
        if len(values) != len(set(values)):
            raise ValueError("Duplicate message ids are not allowed")
        return values


class CreateTextMessage(BaseModel):
    content: str = Field(max_length=8192)
    client_message_id: UUID | None = None
    reply_to_id: Annotated[
        Optional[int],
        Field(None, ge=1, le=2_147_483_647),
    ]


class UpdateTextMessage(BaseModel):
    content: str = Field(max_length=8192)


class CreateTextMessageDB(BaseModel):
    content: str
    status: MessagesStatus
    type: MessagesTypes
    client_message_id: UUID | None = None
    reply_to_id: int | None = None


class CreateEncryptedMessage(BaseModel):
    algorithm: Literal["m.megolm.v1.aes-sha2"]
    encrypted_content: dict[str, Any]
    client_message_id: UUID | None = None
    reply_to_id: Annotated[
        Optional[int],
        Field(None, ge=1, le=2_147_483_647),
    ]

    @field_validator("encrypted_content")
    @classmethod
    def validate_encrypted_content(cls, value: dict[str, Any]):
        required = {
            "algorithm",
            "ciphertext",
            "device_id",
            "sender_key",
            "session_id",
        }
        if not required.issubset(value):
            raise ValueError("Incomplete encrypted message")
        if value.get("algorithm") != "m.megolm.v1.aes-sha2":
            raise ValueError("Unsupported encrypted message algorithm")
        if len(json.dumps(value, separators=(",", ":"))) > 65_536:
            raise ValueError("Encrypted message is too large")
        return value


class CreateEncryptedMessageDB(BaseModel):
    content: None = None
    status: MessagesStatus
    type: MessagesTypes
    encryption_algorithm: str
    encrypted_content: dict[str, Any]
    client_message_id: UUID | None = None
    reply_to_id: int | None = None


class CreateMediaMessage(BaseModel):
    file: bytes
    file_name: str
    file_type: str
    caption: Annotated[Optional[str], Field(max_length=8192)]
    is_voice_message: bool
    client_message_id: UUID | None = None
    reply_to_id: int | None = None


class CreateMediaMessageDB(BaseModel):
    file_content_name: str
    file_content_type: str
    file_size: int
    status: MessagesStatus
    type: MessagesTypes
    content: Annotated[Optional[str], Field(max_length=8192)]
    original_file_name: Annotated[Optional[str], Field(None, max_length=255)]
    client_message_id: UUID | None = None
    reply_to_id: int | None = None


class MessageReaction(BaseModel):
    user_id: int
    emoji: str


class ReactionAction(BaseModel):
    emoji: Literal["👍", "❤️", "😂", "😮", "😢", "🔥"]


class GetMessage(BaseModel):
    id: int
    conversation_id: int
    sender_id: int
    status: MessagesStatus
    type: MessagesTypes
    content: Optional[str]
    file_content_name: Optional[str]
    file_content_type: Optional[str]
    file_size: Optional[int]
    original_file_name: Optional[str] = None
    client_message_id: UUID | None = None
    reply_to_id: Optional[int] = None
    encryption_algorithm: Optional[str] = None
    encrypted_content: Optional[dict[str, Any]] = None
    reactions: list[MessageReaction] = Field(default_factory=list)
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
