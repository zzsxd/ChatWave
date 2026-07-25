from fastapi.responses import StreamingResponse
from pathlib import Path
import re

from validators import (
    validate_user_in_conversation,
    validate_user_is_message_owner,
    validate_user_have_access_to_message,
    validate_user_have_access_to_messages,
    validate_user_can_manage_messages
)
from repository import (
    insert_text_message_with_notifications,
    reserve_message_id,
    insert_media_message_with_notifications,
    update_message,
    select_filtered_messages,
    select_message,
    select_message_by_client_id,
    select_messages,
    delete_messages,
    select_messages_by_content,
    delete_unread_messages,
    select_last_message,
    update_message_receipt,
    select_message_receipt_status,
    select_message_receipts_statuses,
    mark_message_receipts_read,
    select_receipts_for_messages,
    select_message_reactions,
    toggle_message_reaction,
    select_conversation_messages_by_types,
    insert_pinned_message,
    delete_pinned_message,
    select_pinned_messages,
)
from schemas import (
    CreateTextMessageDB,
    CreateEncryptedMessage,
    CreateEncryptedMessageDB,
    CreateMediaMessage,
    CreateMediaMessageDB,
    GetMessage,
    FilterUnreadMessages,
    MessageReaction,
)
from storage import FileManager
from utilities import (
    MessagesStatus,
    MessagesTypes,
    many_sqlalchemy_to_pydantic,
    sqlalchemy_to_pydantic,
    FileNotFound,
    FileRangeError,
    FIleToBig,
    generic_settings,
    MediaPatches,
    MessageNotFound,
    AccessDeniedError,
)
from .message_events import (
    publish_message_created,
    publish_message_updated,
    publish_messages_deleted,
    publish_message_statuses,
)


async def _validate_reply(conversation_id: int, reply_to_id: int | None) -> None:
    if reply_to_id is None:
        return
    reply = await select_message(message_id=reply_to_id)
    if reply is None or reply.conversation_id != conversation_id:
        raise AccessDeniedError()


async def _hydrate_reactions(messages: list[GetMessage]) -> None:
    rows = await select_message_reactions([message.id for message in messages])
    reactions_by_message: dict[int, list[MessageReaction]] = {}
    for message_id, user_id, emoji in rows:
        reactions_by_message.setdefault(message_id, []).append(
            MessageReaction(user_id=user_id, emoji=emoji)
        )
    for message in messages:
        message.reactions = reactions_by_message.get(message.id, [])


async def create_text_message(
    sender_id: int,
    conversation_id: int,
    content: str,
    client_message_id=None,
    reply_to_id: int | None = None,
) -> GetMessage:
    await validate_user_in_conversation(user_id=sender_id, conversation_id=conversation_id)
    await _validate_reply(conversation_id, reply_to_id)

    new_message_obj = CreateTextMessageDB(
        content=content,
        status=MessagesStatus.SENT,
        type=MessagesTypes.TEXT,
        client_message_id=client_message_id,
        reply_to_id=reply_to_id,
    )
    new_message_id, created = await insert_text_message_with_notifications(
        sender_id=sender_id,
        conversation_id=conversation_id,
        message_data=new_message_obj
    )
    raw_message = await select_message(message_id=new_message_id)
    new_message_obj = await sqlalchemy_to_pydantic(
        sqlalchemy_model=raw_message,
        pydantic_model=GetMessage
    )
    await _hydrate_reactions([new_message_obj])
    if created:
        await publish_message_created(new_message_obj)

    return new_message_obj


async def create_encrypted_message(
    sender_id: int,
    conversation_id: int,
    message_data: CreateEncryptedMessage,
) -> GetMessage:
    await validate_user_in_conversation(
        user_id=sender_id,
        conversation_id=conversation_id,
    )
    await _validate_reply(conversation_id, message_data.reply_to_id)
    encrypted_message = CreateEncryptedMessageDB(
        status=MessagesStatus.SENT,
        type=MessagesTypes.TEXT,
        encryption_algorithm=message_data.algorithm,
        encrypted_content=message_data.encrypted_content,
        client_message_id=message_data.client_message_id,
        reply_to_id=message_data.reply_to_id,
    )
    message_id, created = await insert_text_message_with_notifications(
        sender_id=sender_id,
        conversation_id=conversation_id,
        message_data=encrypted_message,
    )
    raw_message = await select_message(message_id=message_id)
    message = await sqlalchemy_to_pydantic(
        sqlalchemy_model=raw_message,
        pydantic_model=GetMessage,
    )
    await _hydrate_reactions([message])
    if created:
        await publish_message_created(message)
    return message


async def create_media_message(sender_id: int, conversation_id: int, content_data: CreateMediaMessage) -> GetMessage:

    async def is_voice_message(_message_type):
        if _message_type != MessagesTypes.AUDIO:
            new_message_type = _message_type
        elif content_data.is_voice_message:
            new_message_type = MessagesTypes.VOICE
        else:
            new_message_type = MessagesTypes.AUDIO

        return new_message_type

    async def get_message_type():
        file_manager = FileManager()
        _message_type = await file_manager.detect_file_type(file_type=content_data.file_type)
        await file_manager.validate_file(
            file_content=content_data.file,
            file_type=content_data.file_type,
            file_type_filter=_message_type
        )
        _message_type = await is_voice_message(_message_type)

        return _message_type

    async def save_media_to_file():
        avatar_save_path = MediaPatches.MEDIA_MESSAGES_FOLDER.value / file_name
        await FileManager().write_file(file_path=avatar_save_path, file_data=content_data.file)

    await validate_user_in_conversation(user_id=sender_id, conversation_id=conversation_id)
    await _validate_reply(conversation_id, content_data.reply_to_id)
    if content_data.client_message_id is not None:
        existing = await select_message_by_client_id(
            sender_id,
            str(content_data.client_message_id),
        )
        if existing is not None:
            if existing.conversation_id != conversation_id:
                raise AccessDeniedError()
            existing_message = await sqlalchemy_to_pydantic(
                sqlalchemy_model=existing,
                pydantic_model=GetMessage,
            )
            await set_effective_message_status(sender_id, existing_message)
            await _hydrate_reactions([existing_message])
            return existing_message

    message_type = await get_message_type()
    message_id = await reserve_message_id()
    file_name = str(message_id)
    new_message_obj = CreateMediaMessageDB(
        file_content_name=file_name,
        file_content_type=(
            "application/octet-stream"
            if message_type == MessagesTypes.FILE
            else content_data.file_type.split(";", 1)[0].strip().lower()
        ),
        file_size=len(content_data.file),
        status=MessagesStatus.SENT,
        type=message_type,
        content=content_data.caption,
        original_file_name=Path(content_data.file_name).name[:255],
        client_message_id=content_data.client_message_id,
        reply_to_id=content_data.reply_to_id,
    )

    media_path = MediaPatches.MEDIA_MESSAGES_FOLDER.value / file_name
    try:
        await save_media_to_file()
        persisted_id, created = await insert_media_message_with_notifications(
            message_id=message_id,
            sender_id=sender_id,
            conversation_id=conversation_id,
            message_data=new_message_obj,
        )
        if not created:
            await FileManager().delete_file(media_path)
    except Exception:
        if await FileManager().file_exists(media_path):
            await FileManager().delete_file(media_path)
        raise
    raw_message = await select_message(message_id=persisted_id)
    new_message_obj = await sqlalchemy_to_pydantic(
        sqlalchemy_model=raw_message,
        pydantic_model=GetMessage
    )
    await _hydrate_reactions([new_message_obj])
    if created:
        await publish_message_created(new_message_obj)

    return new_message_obj


async def update_user_message(
    sender_id: int,
    message_id: int,
    content: str,
) -> GetMessage:
    await validate_user_is_message_owner(user_id=sender_id, message_id=message_id)
    existing = await select_message(message_id=message_id)
    if existing is None or existing.encrypted_content is not None:
        raise AccessDeniedError()

    await update_message(
        message_id=message_id,
        content=content
    )
    raw_message = await select_message(message_id=message_id)
    message = await sqlalchemy_to_pydantic(
        sqlalchemy_model=raw_message,
        pydantic_model=GetMessage,
    )
    await _hydrate_reactions([message])
    await set_effective_message_status(sender_id, message)
    await publish_message_updated(message)
    return message


async def mark_message_delivered(user_id: int, message_id: int):
    status = await select_message_receipt_status(message_id=message_id, user_id=user_id)
    if status == MessagesStatus.SENT:
        await update_message_receipt(
            message_id=message_id,
            user_id=user_id,
            status=MessagesStatus.DELIVERED,
        )


async def mark_message_read(user_id: int, message_id: int):
    status = await select_message_receipt_status(message_id=message_id, user_id=user_id)
    if status is not None and status != MessagesStatus.READ:
        await update_message_receipt(
            message_id=message_id,
            user_id=user_id,
            status=MessagesStatus.READ,
        )
    await delete_unread_messages(
        filter_conditions=FilterUnreadMessages(
            user_id=user_id,
            message_id=message_id
        )
    )


async def set_effective_message_status(user_id: int, message_obj: GetMessage) -> None:
    if message_obj.sender_id != user_id:
        receipt_status = await select_message_receipt_status(
            message_id=message_obj.id,
            user_id=user_id,
        )
        if receipt_status is not None:
            message_obj.status = receipt_status
        return

    statuses = await select_message_receipts_statuses(message_id=message_obj.id)
    if not statuses:
        message_obj.status = MessagesStatus.SENT
    elif all(status == MessagesStatus.READ for status in statuses):
        message_obj.status = MessagesStatus.READ
    elif all(status in (MessagesStatus.DELIVERED, MessagesStatus.READ) for status in statuses):
        message_obj.status = MessagesStatus.DELIVERED
    else:
        message_obj.status = MessagesStatus.SENT


async def set_effective_messages_statuses(
    user_id: int,
    messages_objs: list[GetMessage],
) -> None:
    incoming_ids = [
        message.id
        for message in messages_objs
        if message.sender_id != user_id
    ]
    await mark_message_receipts_read(
        user_id=user_id,
        message_ids=incoming_ids,
    )
    receipt_rows = await select_receipts_for_messages(
        [message.id for message in messages_objs]
    )
    statuses_by_message: dict[int, list[tuple[int, MessagesStatus]]] = {}
    for message_id, recipient_id, receipt_status in receipt_rows:
        statuses_by_message.setdefault(message_id, []).append(
            (recipient_id, receipt_status)
        )

    status_updates = []
    for message in messages_objs:
        statuses = statuses_by_message.get(message.id, [])
        if message.sender_id != user_id:
            own_status = next(
                (status for recipient_id, status in statuses if recipient_id == user_id),
                None,
            )
            if own_status is not None:
                message.status = own_status
            recipient_statuses = [status for _, status in statuses]
            if not recipient_statuses:
                effective_status = MessagesStatus.SENT
            elif all(
                status == MessagesStatus.READ for status in recipient_statuses
            ):
                effective_status = MessagesStatus.READ
            elif all(
                status in (MessagesStatus.DELIVERED, MessagesStatus.READ)
                for status in recipient_statuses
            ):
                effective_status = MessagesStatus.DELIVERED
            else:
                effective_status = MessagesStatus.SENT
            status_updates.append(
                {
                    "message_id": message.id,
                    "status": effective_status.value,
                }
            )
            continue

        recipient_statuses = [status for _, status in statuses]
        if not recipient_statuses:
            message.status = MessagesStatus.SENT
        elif all(status == MessagesStatus.READ for status in recipient_statuses):
            message.status = MessagesStatus.READ
        elif all(
            status in (MessagesStatus.DELIVERED, MessagesStatus.READ)
            for status in recipient_statuses
        ):
            message.status = MessagesStatus.DELIVERED
        else:
            message.status = MessagesStatus.SENT
    if status_updates and messages_objs:
        await publish_message_statuses(
            messages_objs[0].conversation_id,
            status_updates,
        )


async def fetch_messages(
    sender_id: int,
    conversation_id: int,
    limit: int,
    offset: int,
    before_id: int | None = None,
) -> list[GetMessage]:
    await validate_user_in_conversation(user_id=sender_id, conversation_id=conversation_id)

    raw_messages = await select_filtered_messages(
        conversation_id=conversation_id,
        limit=limit,
        offset=offset,
        before_id=before_id,
    )
    messages_objs = await many_sqlalchemy_to_pydantic(
        sqlalchemy_models=raw_messages,
        pydantic_model=GetMessage
    )
    await set_effective_messages_statuses(
        user_id=sender_id,
        messages_objs=messages_objs,
    )
    await _hydrate_reactions(messages_objs)

    return messages_objs


async def fetch_last_message(sender_id: int, conversation_id: int) -> GetMessage | None:
    await validate_user_in_conversation(user_id=sender_id, conversation_id=conversation_id)

    raw_message = await select_last_message(conversation_id=conversation_id)
    if not raw_message:
        raise MessageNotFound()

    message_obj = await sqlalchemy_to_pydantic(
        sqlalchemy_model=raw_message,
        pydantic_model=GetMessage
    )
    await set_effective_message_status(user_id=sender_id, message_obj=message_obj)
    await _hydrate_reactions([message_obj])

    return message_obj


async def search_conversation_messages(user_id: int, conversations_id: int, search_query: str, limit: int) -> list[GetMessage]:
    await validate_user_in_conversation(user_id=user_id, conversation_id=conversations_id)

    raw_messages = await select_messages_by_content(
        conversation_id=conversations_id,
        search_query=search_query,
        limit=limit
    )
    messages_objs = await many_sqlalchemy_to_pydantic(
        sqlalchemy_models=raw_messages,
        pydantic_model=GetMessage
    )
    for message in messages_objs:
        await set_effective_message_status(user_id, message)
    await _hydrate_reactions(messages_objs)

    return messages_objs


async def fetch_conversation_media(
    user_id: int,
    conversation_id: int,
    kind: str,
    limit: int,
    offset: int,
) -> list[GetMessage]:
    await validate_user_in_conversation(user_id, conversation_id)
    message_types = (
        [MessagesTypes.IMAGE, MessagesTypes.VIDEO]
        if kind == "media"
        else [MessagesTypes.AUDIO, MessagesTypes.VOICE, MessagesTypes.FILE]
    )
    raw_messages = await select_conversation_messages_by_types(
        conversation_id,
        message_types,
        limit,
        offset,
    )
    messages = await many_sqlalchemy_to_pydantic(
        sqlalchemy_models=raw_messages,
        pydantic_model=GetMessage,
    )
    for message in messages:
        await set_effective_message_status(user_id, message)
    await _hydrate_reactions(messages)
    return messages


async def fetch_pinned_messages(
    user_id: int,
    conversation_id: int,
) -> list[GetMessage]:
    await validate_user_in_conversation(user_id, conversation_id)
    raw_messages = await select_pinned_messages(conversation_id)
    messages = await many_sqlalchemy_to_pydantic(
        sqlalchemy_models=raw_messages,
        pydantic_model=GetMessage,
    )
    for message in messages:
        await set_effective_message_status(user_id, message)
    await _hydrate_reactions(messages)
    return messages


async def pin_message(user_id: int, message_id: int) -> None:
    await validate_user_have_access_to_message(user_id, message_id)
    message = await select_message(message_id)
    if message is None:
        raise MessageNotFound()
    await insert_pinned_message(
        conversation_id=message.conversation_id,
        message_id=message.id,
        pinned_by=user_id,
    )


async def unpin_message(user_id: int, message_id: int) -> None:
    await validate_user_have_access_to_message(user_id, message_id)
    await delete_pinned_message(message_id)


async def react_to_message(
    user_id: int,
    message_id: int,
    emoji: str,
) -> GetMessage:
    await validate_user_have_access_to_message(
        user_id=user_id,
        message_id=message_id,
    )
    await toggle_message_reaction(message_id, user_id, emoji)
    raw_message = await select_message(message_id=message_id)
    message = await sqlalchemy_to_pydantic(
        sqlalchemy_model=raw_message,
        pydantic_model=GetMessage,
    )
    await set_effective_message_status(user_id, message)
    await _hydrate_reactions([message])
    await publish_message_updated(message)
    return message


async def parse_bytes_file_range(bytes_range: str, file_size: int) -> tuple[int, int]:
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", bytes_range.strip())
    if match is None or not any(match.groups()) or file_size <= 0:
        raise FileRangeError()

    start_raw, end_raw = match.groups()
    if not start_raw:
        suffix_length = int(end_raw)
        if suffix_length <= 0:
            raise FileRangeError()
        return max(0, file_size - suffix_length), file_size - 1

    start_byte = int(start_raw)
    end_byte = int(end_raw) if end_raw else file_size - 1
    if start_byte >= file_size or end_byte < start_byte:
        raise FileRangeError()

    return start_byte, min(end_byte, file_size - 1)


async def stream_file(
        file_path: Path,
        file_type: str,
        file_size: int | None = None,
        start_byte: int | None = None,
        end_byte: int | None = None
) -> StreamingResponse:
    file_manager = FileManager()

    if start_byte is not None and end_byte is not None:
        headers = {"Content-Range": f"bytes {start_byte}-{end_byte}/{file_size}", "Accept-Ranges": "bytes"}
        file_generator_obj = await file_manager.range_file_chunk_generator(
            file_path=file_path,
            start_byte=start_byte,
            end_byte=end_byte
        )
        return StreamingResponse(file_generator_obj,
                                 headers=headers,
                                 media_type=file_type,
                                 status_code=206)
    else:
        file_generator_obj = await file_manager.file_chunk_generator(file_paths=[file_path])
        return StreamingResponse(file_generator_obj, media_type=file_type)


async def fetch_message_media_metadata(sender_id: int, message_id: int) -> dict[str, any]:
    await validate_user_have_access_to_message(user_id=sender_id, message_id=message_id)

    message_obj = await select_message(message_id=message_id)
    filepath = MediaPatches.MEDIA_MESSAGES_FOLDER.value / f"{message_obj.file_content_name}"
    if not (await FileManager().file_exists(file_path=filepath)):
        raise FileNotFound()

    return {
        "file_path": filepath,
        "file_type": message_obj.file_content_type,
        "download": message_obj.type == MessagesTypes.FILE,
    }


async def fetch_messages_media_paths(sender_id: int, messages_ids: list[int]) -> list[Path]:
    await validate_user_have_access_to_messages(user_id=sender_id, messages_ids=messages_ids)

    messages_paths = list()
    raw_messages = await select_messages(
        messages_ids=messages_ids
    )
    messages_objs = await many_sqlalchemy_to_pydantic(
        sqlalchemy_models=raw_messages,
        pydantic_model=GetMessage
    )
    aggregate_size = sum(message.file_size or 0 for message in messages_objs)
    max_size = generic_settings.MAX_BULK_DOWNLOAD_SIZE_MB * 1024 * 1024
    if aggregate_size > max_size:
        raise FIleToBig(
            file_type_name="bulk download",
            size_limit=generic_settings.MAX_BULK_DOWNLOAD_SIZE_MB,
        )
    for message_obj in messages_objs:
        if message_obj.file_content_name is None:
            continue

        messages_paths.append(MediaPatches.MEDIA_MESSAGES_FOLDER.value / message_obj.file_content_name)

    if not messages_paths:
        raise FileNotFound()

    return messages_paths


async def remove_messages(user_id: int, messages_ids: list[int]):
    await validate_user_can_manage_messages(user_id=user_id, messages_ids=messages_ids)
    raw_messages = list(await select_messages(messages_ids=messages_ids))
    media_paths = [
        MediaPatches.MEDIA_MESSAGES_FOLDER.value / message.file_content_name
        for message in raw_messages
        if message.file_content_name is not None
    ]
    messages_by_conversation: dict[int, list[int]] = {}
    for message in raw_messages:
        messages_by_conversation.setdefault(message.conversation_id, []).append(
            message.id
        )
    await delete_messages(messages_ids=messages_ids)
    await publish_messages_deleted(messages_by_conversation)
    for media_path in media_paths:
        await FileManager().delete_file(media_path)
