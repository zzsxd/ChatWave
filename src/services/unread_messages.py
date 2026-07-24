from schemas.unread_messages import AddUnreadMessages, AddUnreadMessagesDB
from validators import (
    validate_user_is_message_owner,
    validate_users_in_conversation,
    verify_users_is_existed
)
from repository import (
    insert_unread_messages,
    select_message,
    select_call,
)
from utilities import SameUsersIds, AccessDeniedError


async def add_unread_messages(
        user_id: int,
        conversation_id: int,
        entity_data: AddUnreadMessages,
        users_ids: list[int]
) -> None:
    if user_id in users_ids:
        raise SameUsersIds()
    if entity_data.message_id is not None:
        message_id = entity_data.message_id
        await validate_user_is_message_owner(user_id=user_id, message_id=message_id)
        message_obj = await select_message(message_id=message_id)
        if message_obj.conversation_id != conversation_id:
            raise AccessDeniedError()
    if entity_data.call_id is not None:
        call_obj = await select_call(call_id=entity_data.call_id)
        if (
            call_obj is None
            or call_obj.caller_id != user_id
            or call_obj.conversation_id != conversation_id
        ):
            raise AccessDeniedError()
    await verify_users_is_existed(users_ids=users_ids)
    await validate_users_in_conversation(conversation_id=conversation_id, users_ids=[*users_ids, user_id])

    # Message notifications are created atomically by the server. Keeping the
    # old endpoint as a validated no-op prevents replaying already-read items.
    if entity_data.message_id is not None:
        return

    # Keep the legacy endpoint idempotent. Message creation now inserts these
    # rows server-side, and the repository ignores duplicate notifications.
    await insert_unread_messages(
        unread_messages_data=AddUnreadMessagesDB(
            users_ids=users_ids,
            conversation_id=conversation_id,
            **entity_data.model_dump(exclude_none=True)
        )
    )
