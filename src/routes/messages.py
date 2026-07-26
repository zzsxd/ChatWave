from fastapi import APIRouter, Depends, status, Query, Body, Header
from fastapi.responses import StreamingResponse
from typing import Annotated

from dependencies import verify_token, update_last_online
from validators import verify_current_user_is_existed
from storage import FileManager
from services import (
    update_user_message,
    fetch_message_media_metadata,
    fetch_messages_media_paths,
    remove_messages,
    react_to_message,
    parse_bytes_file_range,
    stream_file,
    pin_message,
    unpin_message,
    transcribe_voice_message,
)
from schemas import (
    GetMessage,
    MessagesIds,
    ReactionAction,
    UpdateTextMessage,
    VoiceTranscription,
)

messages_router = APIRouter(
    prefix="/messages",
    tags=["Messages"],
    dependencies=[Depends(update_last_online), Depends(verify_current_user_is_existed)]
)


@messages_router.put("/{message_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def pin_conversation_message(
        current_user_id: Annotated[int, Depends(verify_token)],
        message_id: int,
):
    await pin_message(current_user_id, message_id)


@messages_router.delete("/{message_id}/pin", status_code=status.HTTP_204_NO_CONTENT)
async def unpin_conversation_message(
        current_user_id: Annotated[int, Depends(verify_token)],
        message_id: int,
):
    await unpin_message(current_user_id, message_id)


@messages_router.get("/{message_id}/media", status_code=status.HTTP_200_OK)
async def get_message_media(
        current_user_id: Annotated[int, Depends(verify_token)],
        message_id: int,
        range: str | None = Header(None),
):
    metadata = await fetch_message_media_metadata(sender_id=current_user_id, message_id=message_id)

    if range:
        file_size = await FileManager().check_file_size(metadata["file_path"])
        start_byte, end_byte = await parse_bytes_file_range(bytes_range=range, file_size=file_size)
        response = await stream_file(
            file_path=metadata["file_path"],
            file_type=metadata["file_type"],
            file_size=file_size,
            start_byte=start_byte,
            end_byte=end_byte,
        )
        if metadata["download"]:
            response.headers["Content-Disposition"] = f'attachment; filename="message-{message_id}"'
        return response

    response = await stream_file(
        file_path=metadata["file_path"],
        file_type=metadata["file_type"]
    )
    if metadata["download"]:
        response.headers["Content-Disposition"] = f'attachment; filename="message-{message_id}"'
    return response


@messages_router.post(
    "/{message_id}/transcription",
    status_code=status.HTTP_200_OK,
    response_model=VoiceTranscription,
)
async def transcribe_message_voice(
    current_user_id: Annotated[int, Depends(verify_token)],
    message_id: int,
):
    return await transcribe_voice_message(current_user_id, message_id)


@messages_router.get("/media", status_code=status.HTTP_200_OK)
async def get_messages_medias(
        current_user_id: Annotated[int, Depends(verify_token)],
        message_id: MessagesIds = Query()
):
    messages_media_paths = await fetch_messages_media_paths(
        sender_id=current_user_id,
        messages_ids=message_id.messages_ids
    )
    files_generator_obj = await FileManager().file_chunk_generator(file_paths=messages_media_paths)

    return StreamingResponse(files_generator_obj, media_type="application/octet-stream")


@messages_router.patch(
    "/{message_id}",
    status_code=status.HTTP_200_OK,
    response_model=GetMessage,
)
async def update_message(
        current_user_id: Annotated[int, Depends(verify_token)],
        message_id: int,
        request: UpdateTextMessage = Body()
):
    return await update_user_message(
        sender_id=current_user_id,
        message_id=message_id,
        content=request.content,
    )


@messages_router.put(
    "/{message_id}/reaction",
    status_code=status.HTTP_200_OK,
    response_model=GetMessage,
)
async def toggle_reaction(
    current_user_id: Annotated[int, Depends(verify_token)],
    message_id: int,
    request: ReactionAction = Body(),
):
    return await react_to_message(
        user_id=current_user_id,
        message_id=message_id,
        emoji=request.emoji,
    )


@messages_router.delete("", status_code=status.HTTP_202_ACCEPTED)
async def delete_messages(
        current_user_id: Annotated[int, Depends(verify_token)],
        message_id: MessagesIds = Query()
):
    await remove_messages(user_id=current_user_id, messages_ids=message_id.messages_ids)
