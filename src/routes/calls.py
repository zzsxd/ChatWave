import base64
import hashlib
import hmac
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response, WebSocket, status

from dependencies import verify_token
from services import calls_listener, disconnect_call, fetch_active_group_calls
from schemas import ActiveGroupCall
from utilities import generic_settings
from .users import run_authenticated_websocket


calls_router = APIRouter(tags=["Calls"], prefix="/calls")


def build_ice_server_config(user_id: int, now: int | None = None) -> dict:
    ice_servers: list[dict] = []
    if generic_settings.STUN_URLS:
        ice_servers.append({"urls": generic_settings.STUN_URLS})

    issued_at = int(time.time()) if now is None else now
    expires_at = issued_at + generic_settings.TURN_CREDENTIAL_TTL_SECONDS
    if generic_settings.TURN_SHARED_SECRET and generic_settings.TURN_URLS:
        username = f"{expires_at}:{user_id}"
        digest = hmac.new(
            generic_settings.TURN_SHARED_SECRET.encode(),
            username.encode(),
            hashlib.sha1,
        ).digest()
        ice_servers.append(
            {
                "urls": generic_settings.TURN_URLS,
                "username": username,
                "credential": base64.b64encode(digest).decode(),
            }
        )
    return {"ice_servers": ice_servers, "expires_at": expires_at}


@calls_router.get("/ice-servers")
async def get_ice_servers(
    current_user_id: Annotated[int, Depends(verify_token)],
):
    return build_ice_server_config(current_user_id)


@calls_router.get(
    "/active-groups",
    response_model=list[ActiveGroupCall],
)
async def get_active_group_calls(
    current_user_id: Annotated[int, Depends(verify_token)],
):
    return await fetch_active_group_calls(current_user_id)


@calls_router.post(
    "/{call_id}/disconnect",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def disconnect_current_call(
    current_user_id: Annotated[int, Depends(verify_token)],
    call_id: Annotated[int, Path(ge=1, le=2_147_483_647)],
):
    await disconnect_call(current_user_id, call_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@calls_router.websocket("/ws")
async def calls_websocket(websocket: WebSocket):
    await run_authenticated_websocket(websocket, calls_listener)
