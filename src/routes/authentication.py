from fastapi import APIRouter, Cookie, Depends, Header, Request, Response, status
from fastapi.security.oauth2 import OAuth2PasswordRequestForm
from typing import Annotated

from dependencies import revoke_token, verify_token_ws
from schemas import CreateUser
from services import (
    authenticate_user,
    create_auth_session,
    create_user,
    refresh_auth_session,
    revoke_auth_session,
)
from utilities import InvalidCredentials, generic_settings


authorization_router = APIRouter(
    tags=['Authorization'],
    prefix="/auth"
)
REFRESH_COOKIE_NAME = "chatwave_refresh"


def _set_refresh_cookie(
    response: Response,
    request: Request,
    refresh_token: str,
) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=generic_settings.REFRESH_SESSION_EXPIRES_SECONDS,
        httponly=True,
        secure=(
            request.url.scheme == "https"
            or generic_settings.MODE == "production"
        ),
        samesite="lax",
        path="/auth",
    )


@authorization_router.post('/login', status_code=status.HTTP_200_OK, response_model=dict)
async def login(
    credentials: Annotated[OAuth2PasswordRequestForm, Depends()],
    request: Request,
    response: Response,
):
    user_id = await authenticate_user(
        username=credentials.username,
        password=credentials.password,
    )
    access_token, refresh_token = await create_auth_session(user_id)
    _set_refresh_cookie(response, request, refresh_token)
    return {"access_token": access_token, "token_type": "bearer"}


@authorization_router.post('/signup', status_code=status.HTTP_201_CREATED)
async def signup(request: CreateUser):
    await create_user(request_data=request)


@authorization_router.post('/logout', status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    authorization: Annotated[str | None, Header()] = None,
    refresh_token: Annotated[
        str | None,
        Cookie(alias=REFRESH_COOKIE_NAME),
    ] = None,
):
    if refresh_token:
        await revoke_auth_session(refresh_token)
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            try:
                await revoke_token(token)
            except InvalidCredentials:
                pass
    response.delete_cookie(
        REFRESH_COOKIE_NAME,
        path="/auth",
        httponly=True,
        samesite="lax",
    )


@authorization_router.post(
    "/refresh",
    status_code=status.HTTP_200_OK,
    response_model=dict,
)
async def refresh_session(
    request: Request,
    response: Response,
    authorization: Annotated[str | None, Header()] = None,
    refresh_token: Annotated[
        str | None,
        Cookie(alias=REFRESH_COOKIE_NAME),
    ] = None,
):
    if refresh_token:
        access_token, refresh_token = await refresh_auth_session(refresh_token)
    else:
        scheme, _, token = (authorization or "").partition(" ")
        user_id = (
            await verify_token_ws(token)
            if scheme.lower() == "bearer" and token
            else None
        )
        if user_id is None:
            raise InvalidCredentials()
        access_token, refresh_token = await create_auth_session(user_id)
    _set_refresh_cookie(response, request, refresh_token)
    return {"access_token": access_token, "token_type": "bearer"}
