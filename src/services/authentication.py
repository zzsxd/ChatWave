import hashlib
import hmac
import json
import secrets
import time
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from schemas import CreateUser, CreateUserDB
from repository import is_user_exists, select_user_by_username, insert_user
from dependencies.redis import redis_client
from utilities import (
    Hash,
    JWT,
    InvalidCredentials,
    UserNotFoundError,
    UserAlreadyExists,
    generic_settings,
)


DUMMY_PASSWORD_HASH = Hash.hash_password("ChatWaveDummyPassword123")


def _refresh_key(token: str) -> str:
    digest = hashlib.sha256(token.encode()).hexdigest()
    return f"auth:refresh:{digest}"


def _session_key(session_id: str) -> str:
    return f"auth:session:{session_id}"


async def authenticate_user(username: str, password: str) -> int:
    user_data = await select_user_by_username(username.strip().lower())

    if not user_data:
        Hash.verify_password(plain_password=password, hashed_password=DUMMY_PASSWORD_HASH)
        raise UserNotFoundError()

    user_id = user_data[0]
    password_hash = user_data[1]

    if not Hash.verify_password(plain_password=password, hashed_password=password_hash):
        raise UserNotFoundError()

    return user_id


async def create_auth_session(user_id: int) -> tuple[str, str]:
    refresh_token = secrets.token_urlsafe(48)
    refresh_key = _refresh_key(refresh_token)
    session_id = str(uuid4())
    session_data = json.dumps(
        {
            "user_id": user_id,
            "session_id": session_id,
            "created_at": int(time.time()),
        },
        separators=(",", ":"),
    )
    ttl = generic_settings.REFRESH_SESSION_EXPIRES_SECONDS
    pipeline = redis_client.pipeline(transaction=True)
    pipeline.setex(refresh_key, ttl, session_data)
    pipeline.setex(_session_key(session_id), ttl, refresh_key)
    await pipeline.execute()
    return JWT.create_token({"id": user_id, "sid": session_id}), refresh_token


async def refresh_auth_session(refresh_token: str) -> tuple[str, str]:
    refresh_key = _refresh_key(refresh_token)
    raw_session = await redis_client.get(refresh_key)
    if raw_session is None:
        raise InvalidCredentials()
    try:
        session = json.loads(
            raw_session.decode() if isinstance(raw_session, bytes) else raw_session
        )
        user_id = int(session["user_id"])
        session_id = str(session["session_id"])
        created_at = int(session["created_at"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise InvalidCredentials()

    active_refresh_key = await redis_client.get(_session_key(session_id))
    if active_refresh_key is None:
        raise InvalidCredentials()
    active_refresh_key = (
        active_refresh_key.decode()
        if isinstance(active_refresh_key, bytes)
        else active_refresh_key
    )
    if not hmac.compare_digest(active_refresh_key, refresh_key):
        raise InvalidCredentials()
    invalid_before = await redis_client.get(f"auth:invalid_before:{user_id}")
    if invalid_before is not None and created_at <= int(invalid_before):
        await revoke_auth_session(refresh_token)
        raise InvalidCredentials()
    if not await is_user_exists(user_id=user_id):
        await revoke_auth_session(refresh_token)
        raise InvalidCredentials()

    ttl = generic_settings.REFRESH_SESSION_EXPIRES_SECONDS
    pipeline = redis_client.pipeline(transaction=True)
    pipeline.expire(refresh_key, ttl)
    pipeline.expire(_session_key(session_id), ttl)
    await pipeline.execute()
    return JWT.create_token({"id": user_id, "sid": session_id}), refresh_token


async def revoke_auth_session(refresh_token: str) -> None:
    refresh_key = _refresh_key(refresh_token)
    raw_session = await redis_client.get(refresh_key)
    keys = [refresh_key]
    if raw_session is not None:
        try:
            session = json.loads(
                raw_session.decode()
                if isinstance(raw_session, bytes)
                else raw_session
            )
            keys.append(_session_key(str(session["session_id"])))
        except (KeyError, TypeError, json.JSONDecodeError):
            pass
    await redis_client.delete(*keys)


async def create_user(request_data: CreateUser) -> None:
    new_user_obj = CreateUserDB(
        password_hash=Hash.hash_password(request_data.password),
        **request_data.model_dump()
    )
    try:
        await insert_user(new_user_obj)
    except IntegrityError:
        raise UserAlreadyExists()
