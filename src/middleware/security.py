import hashlib
import logging
import re
import time

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from dependencies.redis import redis_client
from utilities import JWT, generic_settings

logger = logging.getLogger(__name__)


class RequestBodyTooLarge(Exception):
    pass


class RequestBodyLimitMiddleware:
    def __init__(self, app):
        self.app = app
        self.max_body_size = generic_settings.MAX_REQUEST_BODY_SIZE_MB * 1024 * 1024

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > self.max_body_size:
                    response = JSONResponse(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        content={"detail": "Request body is too large"},
                    )
                    await response(scope, receive, send)
                    return
            except ValueError:
                response = JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": "Invalid Content-Length"},
                )
                await response(scope, receive, send)
                return

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_size:
                    raise RequestBodyTooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except RequestBodyTooLarge:
            response = JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={"detail": "Request body is too large"},
            )
            await response(scope, receive, send)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    _numeric_segment = re.compile(r"/-?\d+(?=/|$)")
    _uuid_segment = re.compile(
        r"/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}"
        r"-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}(?=/|$)"
    )

    @classmethod
    def _normalized_path(cls, path: str) -> str:
        path = cls._numeric_segment.sub("/{id}", path)
        path = cls._uuid_segment.sub("/{uuid}", path)
        return re.sub(r"^/users/avatar/[^/]+$", "/users/avatar/{opaque}", path)

    @staticmethod
    def _limit_for(path: str) -> tuple[int, int]:
        if path == "/auth/login":
            return generic_settings.RATE_LIMIT_LOGIN_PER_MINUTE, 60
        if path == "/auth/signup":
            return generic_settings.RATE_LIMIT_SIGNUP_PER_HOUR, 3600
        return generic_settings.RATE_LIMIT_REQUESTS_PER_MINUTE, 60

    @staticmethod
    def _identity(authorization: str | None, client_host: str) -> str:
        if authorization:
            scheme, _, token = authorization.partition(" ")
            if scheme.lower() == "bearer" and token:
                try:
                    payload = JWT.decode_token(token)
                    return f"user:{payload['id']}"
                except Exception:
                    pass
        return f"ip:{client_host}"

    async def dispatch(self, request: Request, call_next):
        authorization = request.headers.get("authorization")
        client_host = request.client.host if request.client else "unknown"
        identity_source = self._identity(authorization, client_host)
        limit, window = self._limit_for(request.url.path)
        bucket = int(time.time()) // window
        identity = hashlib.sha256(identity_source.encode()).hexdigest()[:24]
        normalized_path = self._normalized_path(request.url.path)
        key = f"rate:{identity}:{request.method}:{normalized_path}:{bucket}"
        current = 0

        try:
            current = await redis_client.incr(key)
            if current == 1:
                await redis_client.expire(key, window + 1)
            if current > limit:
                return JSONResponse(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content={"detail": "Too many requests"},
                    headers={"Retry-After": str(window)},
                )
        except Exception:
            logger.exception("Redis rate limiter is unavailable")
            if request.url.path in {"/auth/login", "/auth/signup"}:
                return JSONResponse(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    content={"detail": "Authentication service is temporarily unavailable"},
                )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - current))
        return response
