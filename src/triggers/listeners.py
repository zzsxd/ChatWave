import asyncio
import asyncpg
import logging
from collections.abc import Awaitable, Callable

from .handlers import (
    handle_unread_messages_changes,
    handle_recipients_change,
    handle_messages_delete_changes,
    handle_conversation_delete_changes,
    handle_user_delete_changes
)
from utilities import db_settings

logger = logging.getLogger(__name__)


async def _listen(channel: str, handler: Callable[[str], Awaitable[None]]) -> None:
    while True:
        connection = None
        notification_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1000)

        def enqueue_notification(_, __, ___, payload: str) -> None:
            try:
                notification_queue.put_nowait(payload)
            except asyncio.QueueFull:
                # PostgreSQL notifications are hints; clients always reload the
                # authoritative state, so one queued hint is sufficient.
                pass

        try:
            connection = await asyncpg.connect(db_settings.asyncpg_postgresql_url)
            await connection.add_listener(channel, enqueue_notification)
            while not connection.is_closed():
                try:
                    payload = await asyncio.wait_for(
                        notification_queue.get(),
                        timeout=1,
                    )
                except TimeoutError:
                    continue
                try:
                    await handler(payload)
                finally:
                    notification_queue.task_done()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Database notification listener failed: %s", channel)
            await asyncio.sleep(2)
        finally:
            if connection is not None and not connection.is_closed():
                await connection.close()


async def setup_unread_messages_changes_listener():
    await _listen("unread_messages_changes", handle_unread_messages_changes)


async def setup_recipients_change_listener():
    await _listen("recipients_change", handle_recipients_change)


async def setup_user_delete_listener():
    await _listen("user_delete", handle_user_delete_changes)


async def setup_conversation_delete_listener():
    await _listen("conversation_delete", handle_conversation_delete_changes)


async def setup_messages_delete_listener():
    await _listen("messages_delete", handle_messages_delete_changes)
