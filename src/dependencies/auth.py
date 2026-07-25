from typing import Annotated
from fastapi import Depends
from jwt.exceptions import InvalidTokenError

from dependencies.redis import redis_client
from utilities import oauth2_scheme, JWT, InvalidCredentials


async def verify_token(token: Annotated[str, Depends(oauth2_scheme)]) -> int:
    try:
        token_payload = JWT.decode_token(token)
        user_id = token_payload['id']
        jti = token_payload["jti"]
        issued_at = int(token_payload["iat"])
        if await redis_client.exists(f"auth:revoked:{jti}"):
            raise InvalidCredentials()
        invalid_before = await redis_client.get(f"auth:invalid_before:{user_id}")
        if invalid_before is not None and issued_at <= int(invalid_before):
            raise InvalidCredentials()
        session_id = token_payload.get("sid")
        if session_id and not await redis_client.exists(
            f"auth:session:{session_id}"
        ):
            raise InvalidCredentials()
    except (InvalidTokenError, KeyError, TypeError, ValueError):
        raise InvalidCredentials()

    return user_id


async def verify_token_ws(token: str, *, allow_expired: bool = False) -> int | None:
    try:
        token_payload = JWT.decode_token(token, verify_exp=not allow_expired)
        user_id = token_payload["id"]
        if await redis_client.exists(f"auth:revoked:{token_payload['jti']}"):
            return None
        invalid_before = await redis_client.get(f"auth:invalid_before:{user_id}")
        if invalid_before is not None and int(token_payload["iat"]) <= int(invalid_before):
            return None
        session_id = token_payload.get("sid")
        if allow_expired and not session_id:
            return None
        if session_id and not await redis_client.exists(
            f"auth:session:{session_id}"
        ):
            return None
    except (InvalidTokenError, KeyError, TypeError, ValueError):
        return None

    return user_id


async def revoke_token(token: str) -> None:
    try:
        token_payload = JWT.decode_token(token)
        ttl = max(0, int(token_payload["exp"]) - int(token_payload["iat"]))
        if ttl:
            await redis_client.setex(f"auth:revoked:{token_payload['jti']}", ttl, "1")
    except (InvalidTokenError, KeyError, TypeError, ValueError):
        raise InvalidCredentials()
