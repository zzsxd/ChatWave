from pydantic_settings import BaseSettings
from pydantic import ConfigDict, Field
from pathlib import Path
from urllib.parse import quote_plus
import os

from .random_generators import generate_jwt_token


class DBSettings(BaseSettings):
    DB_USER: str = "admin"
    DB_PASSWORD: str = "admin"
    DB_DATABASE: str = "postgres"
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432

    TEST_DB_USER: str = "admin"
    TEST_DB_PASSWORD: str = "admin"
    TEST_DB_DATABASE: str = "postgres"
    TEST_DB_HOST: str = "localhost"
    TEST_DB_PORT: int = 5432
    DB_SCHEMA: str = Field(
        default="chatwave",
        pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,62}$",
    )

    @property
    def sqlalchemy_postgresql_url(self):
        return (
            f"postgresql+asyncpg://{quote_plus(self.DB_USER)}:{quote_plus(self.DB_PASSWORD)}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{quote_plus(self.DB_DATABASE)}"
        )

    @property
    def test_sqlalchemy_postgresql_url(self):
        return (
            f"postgresql+psycopg://{quote_plus(self.TEST_DB_USER)}:{quote_plus(self.TEST_DB_PASSWORD)}"
            f"@{self.TEST_DB_HOST}:{self.TEST_DB_PORT}/{quote_plus(self.TEST_DB_DATABASE)}"
        )

    @property
    def asyncpg_postgresql_url(self):
        return (
            f"postgresql://{quote_plus(self.DB_USER)}:{quote_plus(self.DB_PASSWORD)}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{quote_plus(self.DB_DATABASE)}"
        )

    model_config = ConfigDict(extra="allow", env_file=".env")


class RedisSettings(BaseSettings):
    REDIS_USER: str | None = None
    REDIS_PASSWORD: str | None = None
    REDIS_DATABASE: int = 0
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379

    @property
    def redis_url(self):
        if self.REDIS_USER:
            redis_user = self.REDIS_USER
        else:
            redis_user = ""
        if self.REDIS_PASSWORD:
            redis_password = self.REDIS_PASSWORD
        else:
            redis_password = ""
        return (
            f"redis://{quote_plus(redis_user)}:{quote_plus(redis_password)}"
            f"@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DATABASE}"
        )

    model_config = ConfigDict(extra="allow", env_file=".env")


class JWTSettings(BaseSettings):
    JWT_ALGORITHM: str = "HS256"
    JWT_SECRET_KEY: str = generate_jwt_token()
    JWT_ACCESS_TOKEN_EXPIRES: int = 900

    model_config = ConfigDict(extra="allow", env_file=".env")


class GenericSettings(BaseSettings):
    MODE: str = "production"
    API_CORS_ALLOW_ORIGINS: list[str] = []
    MEDIA_FOLDER: Path = Path("/app/data")
    ALLOWED_IMAGE_TYPES: list[str] = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/tiff",
        "image/x-icon"
    ]

    ALLOWED_VIDEO_TYPES: list[str] = [
        "video/mp4",
        "video/webm",
        "video/ogg",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-flv",
        "video/x-matroska",
        "video/mpeg",
        "video/3gpp",
        "video/3gpp2"
    ]

    ALLOWED_AUDIO_TYPES: list[str] = [
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
        "audio/webm",
        "audio/aac",
        "audio/flac",
        "audio/x-wav",
        "audio/x-m4a",
        "audio/x-flac",
        "audio/mp4",
        "audio/midi",
        "audio/x-midi"
    ]
    MAX_UPLOAD_IMAGE_SIZE: int = 20
    MAX_UPLOAD_VIDEO_SIZE: int = 256
    MAX_UPLOAD_AUDIO_SIZE: int = 64
    MAX_UPLOAD_FILE_SIZE: int = 128
    MAX_REQUEST_BODY_SIZE_MB: int = 260
    MAX_ARCHIVE_SIZE_MB: int = 200
    MAX_BULK_DOWNLOAD_SIZE_MB: int = 512
    MAX_MEDIA_STORAGE_PER_USER_MB: int = 2048
    CHUNK_SIZE: int = 16
    MAX_ITEMS_PER_REQUEST: int = 100
    RATE_LIMIT_REQUESTS_PER_MINUTE: int = 300
    RATE_LIMIT_LOGIN_PER_MINUTE: int = 10
    RATE_LIMIT_SIGNUP_PER_HOUR: int = 5
    RATE_LIMIT_WEBSOCKET_HANDSHAKES_PER_MINUTE: int = 30
    TRUSTED_PROXY_CIDRS: list[str] = [
        "127.0.0.0/8",
        "::1/128",
    ]
    MAX_WEBSOCKETS_PER_USER: int = 12
    REFRESH_SESSION_EXPIRES_SECONDS: int = Field(
        default=34_560_000,
        ge=86_400,
        le=34_560_000,
    )
    MAX_UNREAD_PAGE_SIZE: int = 100
    TURN_SHARED_SECRET: str | None = None
    TURN_URLS: list[str] = []
    STUN_URLS: list[str] = [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
    ]
    TURN_CREDENTIAL_TTL_SECONDS: int = Field(default=3600, ge=300, le=86_400)

    model_config = ConfigDict(extra="allow", env_file=".env")


redis_settings = RedisSettings()
db_settings = DBSettings()
jwt_settings = JWTSettings()
generic_settings = GenericSettings()


def validate_runtime_settings() -> None:
    if generic_settings.MODE != "production":
        return

    unsafe_values = []
    if db_settings.DB_USER == "admin" and db_settings.DB_PASSWORD == "admin":
        unsafe_values.append("DB_USER/DB_PASSWORD")
    if not redis_settings.REDIS_PASSWORD:
        unsafe_values.append("REDIS_PASSWORD")
    if not os.getenv("JWT_SECRET_KEY") or len(jwt_settings.JWT_SECRET_KEY) < 64:
        unsafe_values.append("JWT_SECRET_KEY (must contain at least 64 characters)")
    if jwt_settings.JWT_ALGORITHM != "HS256":
        unsafe_values.append("JWT_ALGORITHM must be HS256")
    if db_settings.DB_SCHEMA != "chatwave":
        unsafe_values.append("DB_SCHEMA must be 'chatwave' until legacy migrations are squashed")
    if not generic_settings.API_CORS_ALLOW_ORIGINS:
        unsafe_values.append("API_CORS_ALLOW_ORIGINS")
    if "*" in generic_settings.API_CORS_ALLOW_ORIGINS:
        unsafe_values.append("API_CORS_ALLOW_ORIGINS cannot contain '*'")
    if bool(generic_settings.TURN_SHARED_SECRET) != bool(generic_settings.TURN_URLS):
        unsafe_values.append("TURN_SHARED_SECRET and TURN_URLS must be configured together")
    if (
        generic_settings.TURN_SHARED_SECRET
        and len(generic_settings.TURN_SHARED_SECRET) < 32
    ):
        unsafe_values.append("TURN_SHARED_SECRET (must contain at least 32 characters)")

    if unsafe_values:
        raise RuntimeError(
            "Unsafe production configuration: " + ", ".join(unsafe_values)
        )
