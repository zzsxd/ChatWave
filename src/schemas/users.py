from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Annotated, Optional
from datetime import datetime, date
from utilities import (
    validate_password,
    request_limit,
    ConversationMemberRoles,
    ValidateModelNotEmpty,
)


class UsersIds(BaseModel):
    users_ids: list[Annotated[int, Field(ge=1, le=2_147_483_647)]]

    @field_validator('users_ids', mode='after')
    def set_limits(cls, values):
        values = request_limit(values)
        if not values:
            raise ValueError("At least one user id is required")
        if len(values) != len(set(values)):
            raise ValueError("Duplicate user ids are not allowed")
        return values


class CreateUser(BaseModel):
    nickname: Annotated[str, Field(min_length=3, max_length=128)]
    username: Annotated[str, Field(min_length=3, max_length=64)]
    password: Annotated[str, Field(min_length=8, max_length=128)]

    @field_validator('password')
    def validate_password(cls, value):
        return validate_password(value)

    @field_validator("username")
    def normalize_username(cls, value):
        return value.strip().lower()

    @field_validator("nickname")
    def normalize_nickname(cls, value):
        return value.strip()


class CreateUserDB(BaseModel):
    nickname: Annotated[str, Field(min_length=3, max_length=128)]
    username: Annotated[str, Field(min_length=3, max_length=64)]
    password_hash: str


class PublicUser(BaseModel):
    id: int
    nickname: Annotated[str, Field(min_length=3, max_length=128)]
    bio: Optional[str]
    avatar_name: Optional[str]
    avatar_type: Optional[str]


class PrivateUser(PublicUser):
    username: Annotated[str, Field(min_length=3, max_length=64)]
    birthday: Optional[date]
    last_online: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]


class UserRole(BaseModel):
    user_id: int
    user_role: ConversationMemberRoles


class UpdateUser(ValidateModelNotEmpty):
    model_config = ConfigDict(extra="forbid")

    username: Annotated[
        Optional[str],
        Field(None, min_length=3, max_length=64, pattern=r"^[a-z0-9_.-]+$"),
    ]
    nickname: Annotated[Optional[str], Field(None, min_length=3, max_length=128)]
    birthday: Annotated[Optional[date], Field(None)]
    bio: Annotated[Optional[str], Field(None, max_length=8192)]

    @field_validator("username")
    def normalize_username(cls, value):
        if value is None:
            return value
        normalized = value.strip().lower()
        if len(normalized) < 3:
            raise ValueError("Username must contain at least 3 characters")
        return normalized

    @field_validator("nickname")
    def normalize_nickname(cls, value):
        if value is None:
            return value
        normalized = value.strip()
        if len(normalized) < 3:
            raise ValueError("Nickname must contain at least 3 characters")
        return normalized

    @field_validator("birthday")
    def validate_birthday(cls, value):
        if value is not None and value > date.today():
            raise ValueError("Birthday cannot be in the future")
        return value


class ChangePassword(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Annotated[str, Field(min_length=8, max_length=128)]

    @field_validator("new_password")
    def validate_new_password(cls, value):
        return validate_password(value)


class UpdateUserDB(BaseModel):
    username: Annotated[Optional[str], Field(None, min_length=3, max_length=64)]
    nickname: Annotated[Optional[str], Field(None, min_length=3, max_length=128)]
    password_hash: Annotated[Optional[str], Field(None)]
    birthday: Annotated[Optional[date], Field(None)]
    bio: Annotated[Optional[str], Field(None, max_length=8192)]
    avatar_name: Annotated[Optional[str], Field(None)]
    avatar_type: Annotated[Optional[str], Field(None)]


class Avatar(BaseModel):
    file: bytes
    file_name: str
    content_type: str


class UserOnline(BaseModel):
    user_id: int
    last_online: Optional[datetime]
    online: bool = False


class AvatarHistoryItem(BaseModel):
    avatar_name: str
    avatar_type: str
    created_at: datetime
    current: bool = False
