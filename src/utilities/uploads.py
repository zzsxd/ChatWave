import asyncio

from fastapi import UploadFile

from .exceptions_storage import FIleToBig

upload_semaphore = asyncio.Semaphore(2)


async def read_upload_limited(
    upload: UploadFile,
    max_size_mb: int,
    file_type_name: str,
) -> bytes:
    max_size_bytes = max_size_mb * 1024 * 1024
    content = bytearray()

    async with upload_semaphore:
        try:
            while chunk := await upload.read(1024 * 1024):
                content.extend(chunk)
                if len(content) > max_size_bytes:
                    raise FIleToBig(file_type_name=file_type_name, size_limit=max_size_mb)
        finally:
            await upload.close()

    return bytes(content)
