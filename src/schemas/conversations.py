from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from typing import Annotated, Optional

from .users import UserRole
from utilities import ValidateModelNotEmpty, request_limit, ConversationTypes


class ConversationsIds(BaseModel):
    conversations_ids: list[Annotated[int, Field(ge=1, le=2_147_483_647)]]

    @field_validator('conversations_ids', mode='after')
    def set_limits(cls, values):
        values = request_limit(values)
        if not values:
            raise ValueError("At least one conversation id is required")
        if len(values) != len(set(values)):
            raise ValueError("Duplicate conversation ids are not allowed")
        return values


class CreateEmptyConversation(BaseModel):
    creator_id: int
    type: ConversationTypes


class CreateGroup(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=64)]
    description: Annotated[Optional[str], Field(None, max_length=256)]


class CreateGroupDB(CreateEmptyConversation, CreateGroup):
    pass


class EditConversation(ValidateModelNotEmpty):
    name: Annotated[Optional[str], Field(None, min_length=1, max_length=64)]
    description: Annotated[Optional[str], Field(None, max_length=256)]


class EditConversationDB(EditConversation):
    avatar_name: Annotated[Optional[str], Field(None)]
    avatar_type: Annotated[Optional[str], Field(None)]


class GetConversations(BaseModel):
    id: int
    type: ConversationTypes
    name: Annotated[Optional[str], Field(min_length=1, max_length=64)]
    description: Optional[str]
    avatar_name: Optional[str]
    avatar_type: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]


class GetConversationsWithMembers(GetConversations):
    members: list["UserRole"]


class DeleteGroupMembers(BaseModel):
    user_id: Annotated[int, Field(ge=1, le=2_147_483_647)]
    delete_messages: bool
