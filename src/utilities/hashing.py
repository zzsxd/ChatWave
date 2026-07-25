import jwt
import bcrypt
from datetime import datetime, timedelta, timezone
from fastapi.security import OAuth2PasswordBearer
import uuid

from utilities import jwt_settings


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


class Hash:

    @staticmethod
    def hash_password(plain_password: str) -> str:
        password_bytes = plain_password.encode("utf-8")
        if len(password_bytes) > 72:
            raise ValueError("Password must not exceed 72 UTF-8 bytes")
        return bcrypt.hashpw(password_bytes, bcrypt.gensalt(rounds=12)).decode("ascii")

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        try:
            return bcrypt.checkpw(
                plain_password.encode("utf-8"),
                hashed_password.encode("ascii"),
            )
        except (ValueError, UnicodeError):
            return False


class JWT:

    @staticmethod
    def create_token(payload: dict) -> str:
        copied_payload = payload.copy()
        now = datetime.now(timezone.utc)
        copied_payload.update(
            {
                "iat": now,
                "exp": now + timedelta(seconds=jwt_settings.JWT_ACCESS_TOKEN_EXPIRES),
                "jti": str(uuid.uuid4()),
                "type": "access",
            }
        )
        token = jwt.encode(copied_payload, key=jwt_settings.JWT_SECRET_KEY, algorithm=jwt_settings.JWT_ALGORITHM)
        return token

    @staticmethod
    def decode_token(token: str, *, verify_exp: bool = True) -> dict:
        payload = jwt.decode(
            jwt=token,
            key=jwt_settings.JWT_SECRET_KEY,
            algorithms=[jwt_settings.JWT_ALGORITHM],
            options={
                "require": ["exp", "iat", "jti"],
                "verify_exp": verify_exp,
            },
        )
        if payload.get("type") != "access" or not isinstance(payload.get("id"), int):
            raise ValueError("Invalid access token claims")
        return payload
