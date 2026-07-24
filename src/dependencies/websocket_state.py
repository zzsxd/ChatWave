import time
from uuid import uuid4

from .redis import redis_client


WEBSOCKET_LEASE_SECONDS = 30


def _leases_key(user_id: int) -> str:
    return f"ws:leases:{user_id}"


async def acquire_websocket_lease(
    user_id: int,
    connection_limit: int,
) -> tuple[str, int] | None:
    connection_id = uuid4().hex
    now = int(time.time())
    expires_at = now + WEBSOCKET_LEASE_SECONDS
    result = await redis_client.eval(
        """
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
        local current = redis.call('ZCARD', KEYS[1])
        if current >= tonumber(ARGV[4]) then
            return 0
        end
        redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
        redis.call('EXPIRE', KEYS[1], ARGV[5])
        return current + 1
        """,
        1,
        _leases_key(user_id),
        now,
        expires_at,
        connection_id,
        connection_limit,
        WEBSOCKET_LEASE_SECONDS * 2,
    )
    return (connection_id, int(result)) if int(result) > 0 else None


async def refresh_websocket_lease(user_id: int, connection_id: str) -> bool:
    key = _leases_key(user_id)
    expires_at = int(time.time()) + WEBSOCKET_LEASE_SECONDS
    refreshed = await redis_client.zadd(
        key,
        {connection_id: expires_at},
        xx=True,
        ch=True,
    )
    if refreshed:
        await redis_client.expire(key, WEBSOCKET_LEASE_SECONDS * 2)
    return bool(refreshed)


async def release_websocket_lease(user_id: int, connection_id: str) -> int:
    key = _leases_key(user_id)
    remaining = await redis_client.eval(
        """
        redis.call('ZREM', KEYS[1], ARGV[1])
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
        local current = redis.call('ZCARD', KEYS[1])
        if current == 0 then
            redis.call('DEL', KEYS[1])
        end
        return current
        """,
        1,
        key,
        connection_id,
        int(time.time()),
    )
    return int(remaining)


async def fetch_online_user_ids(user_ids: list[int]) -> set[int]:
    if not user_ids:
        return set()
    now = int(time.time())
    pipeline = redis_client.pipeline(transaction=True)
    for user_id in user_ids:
        key = _leases_key(user_id)
        pipeline.zremrangebyscore(key, "-inf", now)
        pipeline.zcard(key)
    results = await pipeline.execute()
    return {
        user_id
        for index, user_id in enumerate(user_ids)
        if int(results[index * 2 + 1]) > 0
    }
