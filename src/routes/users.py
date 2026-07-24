import asyncio
import time
from fastapi import (
    APIRouter,
    Depends,
    status,
    UploadFile,
    File,
    Query,
    Body,
    WebSocket
)
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from typing import Annotated, Awaitable, Callable

from repository import is_user_exists, update_user_last_online
from schemas import (
    PrivateUser,
    UpdateUser,
    ChangePassword,
    PublicUser,
    Avatar,
    AvatarHistoryItem,
    UsersIds,
    UserOnline,
    GetConversationsWithMembers,
    GetUnreadMessages
)
from dependencies import (
    acquire_websocket_lease,
    refresh_websocket_lease,
    release_websocket_lease,
    verify_token,
    update_last_online,
    verify_token_ws,
    redis_client,
)
from storage import FileManager
from utilities import read_upload_limited, generic_settings
from validators import verify_current_user_is_existed
from services import (
    fetch_private_user,
    update_user_profile,
    change_user_password,
    fetch_public_users,
    upload_user_avatar,
    fetch_users_avatars_paths,
    fetch_user_avatar_metadata,
    remove_user_avatar,
    fetch_user_avatar_history,
    restore_user_avatar,
    search_users_by_nickname,
    fetch_user_conversations,
    remove_user_account,
    leave_group,
    fetch_user_unread_messages,
    fetch_user_recipients_last_online,
    fetch_users_online_status,
    user_last_online_listener,
    unread_messages_listener,
    message_events_listener,
)

users_router = APIRouter(
    tags=["Users"],
    prefix="/users",
    dependencies=[Depends(update_last_online), Depends(verify_current_user_is_existed)]
)

anonymous_users_router = APIRouter(
    tags=["Users"],
    prefix="/users"
)


@users_router.get("/me", status_code=status.HTTP_200_OK, response_model=PrivateUser)
async def get_current_user(
        current_user_id: Annotated[int, Depends(verify_token)]
):
    profile_data = await fetch_private_user(user_id=current_user_id)
    return profile_data


@users_router.get("", status_code=status.HTTP_200_OK, response_model=list[PublicUser])
async def get_users(
        user_id: UsersIds = Query()
):
    users_objects = await fetch_public_users(users_ids=user_id.users_ids)
    return users_objects


@users_router.get("/search", status_code=status.HTTP_200_OK, response_model=list[PublicUser])
async def search_users(
        search_query: str = Query(min_length=3, max_length=128),
        limit: int = Query(50, ge=1, le=100),
):
    users_objects = await search_users_by_nickname(search_query=search_query, limit=limit)
    return users_objects


@anonymous_users_router.get("/avatar/{avatar_uuid}", status_code=status.HTTP_200_OK)
async def get_user_avatar(
        avatar_uuid: str
):
    metadata = await fetch_user_avatar_metadata(avatar_uuid=avatar_uuid)
    return StreamingResponse(
        metadata["file_path"].open("rb"),
        media_type=metadata["content_type"],
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@users_router.get("/avatars", status_code=status.HTTP_200_OK)
async def get_users_avatars(
        user_id: UsersIds = Query()
):
    avatars_paths = await fetch_users_avatars_paths(users_ids=user_id.users_ids)
    zip_obj = await FileManager().archive_files(avatars_paths)
    return StreamingResponse(
        zip_obj,
        media_type="application/zip",
        background=BackgroundTask(zip_obj.close),
    )


@users_router.get("/conversations", status_code=status.HTTP_200_OK, response_model=list[GetConversationsWithMembers])
async def get_current_user_conversations(
        current_user_id: Annotated[int, Depends(verify_token)]
):
    conversations_objs = await fetch_user_conversations(user_id=current_user_id)
    return conversations_objs


@users_router.get("/online", status_code=status.HTTP_200_OK, response_model=list[UserOnline])
async def get_users_last_online(
        current_user_id: Annotated[int, Depends(verify_token)]
):
    recipients_ids = await fetch_user_recipients_last_online(user_id=current_user_id)
    users_last_online = await fetch_users_online_status(users_ids=recipients_ids)
    return users_last_online


async def authenticate_websocket(
    websocket: WebSocket,
) -> tuple[int, str, str] | None:
    origin = websocket.headers.get("origin")
    if origin and origin not in generic_settings.API_CORS_ALLOW_ORIGINS:
        await websocket.close(code=1008)
        return None

    protocols = [
        value.strip()
        for value in websocket.headers.get("sec-websocket-protocol", "").split(",")
        if value.strip()
    ]
    if len(protocols) != 2 or protocols[0].lower() != "bearer":
        await websocket.close(code=1008)
        return None

    current_user_id = await verify_token_ws(protocols[1])
    if current_user_id is None or not await is_user_exists(user_id=current_user_id):
        await websocket.close(code=1008)
        return None

    handshake_bucket = int(time.time()) // 60
    handshake_key = f"rate:ws:user:{current_user_id}:{handshake_bucket}"
    try:
        handshakes = await redis_client.incr(handshake_key)
        if handshakes == 1:
            await redis_client.expire(handshake_key, 61)
        if handshakes > generic_settings.RATE_LIMIT_WEBSOCKET_HANDSHAKES_PER_MINUTE:
            await websocket.close(code=1008)
            return None
    except Exception:
        await websocket.close(code=1013)
        return None

    lease = await acquire_websocket_lease(
        current_user_id,
        generic_settings.MAX_WEBSOCKETS_PER_USER,
    )
    if lease is None:
        await websocket.close(code=1008)
        return None
    connection_id, connections = lease

    await websocket.accept(subprotocol="bearer")
    if connections == 1:
        await redis_client.publish("user:presence_events", str(current_user_id))
    return current_user_id, protocols[1], connection_id


async def release_websocket(current_user_id: int, connection_id: str) -> None:
    connections = await release_websocket_lease(
        current_user_id,
        connection_id,
    )
    if connections <= 0:
        await update_user_last_online(user_id=current_user_id)
        await redis_client.publish(
            "user:last_online_events",
            str(current_user_id),
        )
        await redis_client.publish(
            "user:presence_events",
            str(current_user_id),
        )


async def run_authenticated_websocket(
    websocket: WebSocket,
    listener: Callable[[int, WebSocket], Awaitable[None]],
) -> None:
    authentication = await authenticate_websocket(websocket)
    if authentication is None:
        return
    current_user_id, token, connection_id = authentication

    async def authentication_watchdog() -> None:
        while True:
            await asyncio.sleep(10)
            if (
                await verify_token_ws(token) is not None
                and await is_user_exists(user_id=current_user_id)
            ):
                if await refresh_websocket_lease(
                    current_user_id,
                    connection_id,
                ):
                    continue
            await websocket.close(code=1008)
            return

    listener_task = asyncio.create_task(listener(current_user_id, websocket))
    watchdog_task = asyncio.create_task(authentication_watchdog())
    try:
        _, pending = await asyncio.wait(
            {listener_task, watchdog_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        await asyncio.gather(listener_task, watchdog_task, return_exceptions=True)
    finally:
        await release_websocket(current_user_id, connection_id)


@anonymous_users_router.websocket("/ws/online")
async def get_users_last_online_ws(websocket: WebSocket):
    await run_authenticated_websocket(websocket, user_last_online_listener)


@users_router.get("/messages/unread", status_code=status.HTTP_200_OK, response_model=list[GetUnreadMessages])
async def get_current_user_unread_messages(
        current_user_id: Annotated[int, Depends(verify_token)],
        limit: int = Query(100, ge=1, le=100),
        offset: int = Query(0, ge=0, le=1_000_000),
):
    limit = min(limit, generic_settings.MAX_UNREAD_PAGE_SIZE)
    unread_messages_objs = await fetch_user_unread_messages(
        user_id=current_user_id,
        limit=limit,
        offset=offset,
    )
    return unread_messages_objs


@anonymous_users_router.websocket("/ws/messages/unread")
async def get_current_user_unread_messages_ws(websocket: WebSocket):
    await run_authenticated_websocket(websocket, unread_messages_listener)


@anonymous_users_router.websocket("/ws/messages")
async def get_current_user_message_events_ws(websocket: WebSocket):
    await run_authenticated_websocket(websocket, message_events_listener)


@users_router.put("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def update_current_user_avatar(
        current_user_id: Annotated[int, Depends(verify_token)],
        avatar: UploadFile = File()
):
    avatar_obj = Avatar(
        file=await read_upload_limited(
            avatar,
            generic_settings.MAX_UPLOAD_IMAGE_SIZE,
            "image",
        ),
        file_name=avatar.filename,
        content_type=avatar.content_type
    )
    await upload_user_avatar(user_id=current_user_id, avatar_data=avatar_obj)


@users_router.get(
    "/{user_id}/avatar-history",
    status_code=status.HTTP_200_OK,
    response_model=list[AvatarHistoryItem],
)
async def get_user_avatar_history(
        current_user_id: Annotated[int, Depends(verify_token)],
        user_id: int,
):
    del current_user_id
    return await fetch_user_avatar_history(user_id=user_id)


@users_router.put(
    "/me/avatar/{avatar_uuid}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def use_previous_avatar(
        current_user_id: Annotated[int, Depends(verify_token)],
        avatar_uuid: str,
):
    await restore_user_avatar(current_user_id, avatar_uuid)


@users_router.patch("/me", status_code=status.HTTP_204_NO_CONTENT)
async def update_current_user(
        current_user_id: Annotated[int, Depends(verify_token)],
        request: UpdateUser = Body()
):
    await update_user_profile(user_id=current_user_id, profile_data=request)


@users_router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def update_current_user_password(
        current_user_id: Annotated[int, Depends(verify_token)],
        request: ChangePassword = Body()
):
    await change_user_password(user_id=current_user_id, password_data=request)


@users_router.delete("/me/avatar", status_code=status.HTTP_202_ACCEPTED)
async def delete_current_user_avatar(
        current_user_id: Annotated[int, Depends(verify_token)]
):
    await remove_user_avatar(user_id=current_user_id)


@users_router.delete("/conversations/{group_id}", status_code=status.HTTP_202_ACCEPTED)
async def current_user_leave_from_group(
        current_user_id: Annotated[int, Depends(verify_token)],
        group_id: int,
        delete_messages: bool = False
):
    await leave_group(
        user_id=current_user_id,
        group_id=group_id,
        delete_messages=delete_messages
    )


@users_router.delete("/me", status_code=status.HTTP_202_ACCEPTED)
async def delete_current_user(
        current_user_id: Annotated[int, Depends(verify_token)]
):
    await remove_user_account(user_id=current_user_id)
