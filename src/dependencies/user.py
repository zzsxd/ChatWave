from fastapi import Depends
from typing import Annotated

from dependencies import verify_token, redis_client
from repository import update_user_last_online


async def update_last_online(current_user_id: Annotated[int, Depends(verify_token)]) -> None:
    should_update = await redis_client.set(
        f"user:last_online_throttle:{current_user_id}",
        "1",
        ex=30,
        nx=True,
    )
    if not should_update:
        return
    await update_user_last_online(user_id=current_user_id)
    await redis_client.publish("user:last_online_events", str(current_user_id))
