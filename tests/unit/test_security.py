from datetime import datetime, timezone
from io import BytesIO

import pytest
from fastapi import UploadFile

from middleware import RateLimitMiddleware
from services.messages import parse_bytes_file_range
from utilities import FIleToBig, JWT, jwt_settings, read_upload_limited


def test_access_token_has_short_expiry_and_required_claims():
    payload = JWT.decode_token(JWT.create_token({"id": 42}))

    assert payload["id"] == 42
    assert payload["type"] == "access"
    assert payload["jti"]
    assert 0 < payload["exp"] - payload["iat"] <= jwt_settings.JWT_ACCESS_TOKEN_EXPIRES
    assert payload["exp"] > int(datetime.now(timezone.utc).timestamp())


@pytest.mark.parametrize(
    ("header", "size", "expected"),
    [
        ("bytes=0-9", 100, (0, 9)),
        ("bytes=10-", 100, (10, 99)),
        ("bytes=-10", 100, (90, 99)),
        ("bytes=90-999", 100, (90, 99)),
    ],
)
async def test_range_parser_accepts_only_bounded_single_ranges(header, size, expected):
    assert await parse_bytes_file_range(header, size) == expected


@pytest.mark.parametrize(
    "header",
    ["", "0-1", "bytes=", "bytes=-0", "bytes=20-10", "bytes=100-101", "bytes=1-2,3-4"],
)
async def test_range_parser_rejects_invalid_ranges(header):
    from utilities import FileRangeError

    with pytest.raises(FileRangeError):
        await parse_bytes_file_range(header, 100)


async def test_upload_reader_stops_at_configured_limit():
    upload = UploadFile(filename="large.bin", file=BytesIO(b"x" * (1024 * 1024 + 1)))

    with pytest.raises(FIleToBig):
        await read_upload_limited(upload, max_size_mb=1, file_type_name="file")


def test_rate_limit_normalizes_resource_identifiers():
    first = RateLimitMiddleware._normalized_path(
        "/conversations/12/messages/550e8400-e29b-41d4-a716-446655440000"
    )
    second = RateLimitMiddleware._normalized_path(
        "/conversations/987/messages/123e4567-e89b-42d3-a456-426614174000"
    )

    assert first == second == "/conversations/{id}/messages/{uuid}"


def test_rate_limit_normalizes_negative_and_opaque_resource_identifiers():
    assert (
        RateLimitMiddleware._normalized_path("/conversations/-1/messages")
        == "/conversations/{id}/messages"
    )
    assert (
        RateLimitMiddleware._normalized_path("/users/avatar/arbitrary-value")
        == "/users/avatar/{opaque}"
    )


def test_invalid_authorization_header_cannot_select_a_new_rate_limit_identity():
    assert RateLimitMiddleware._identity("Bearer invalid-token", "192.0.2.1") == "ip:192.0.2.1"


def test_valid_token_rate_limit_identity_is_stable_per_user():
    first = JWT.create_token({"id": 42})
    second = JWT.create_token({"id": 42})

    assert RateLimitMiddleware._identity(f"Bearer {first}", "192.0.2.1") == "user:42"
    assert RateLimitMiddleware._identity(f"Bearer {second}", "192.0.2.2") == "user:42"
