import asyncio
import zipfile
import tempfile
from PIL import Image
from typing import Union, Literal
from pathlib import Path
from io import BytesIO

from utilities import generic_settings, MessagesTypes, ImageCorrupted, InvalidFileType, FIleToBig

archive_semaphore = asyncio.Semaphore(2)


class StorageUtils:
    def __init__(self):
        pass

    @staticmethod
    def create_directory(path: Path):
        path.mkdir(parents=True, exist_ok=True)

    @staticmethod
    async def write_file(file_path: Path, file_data: bytes):
        await asyncio.to_thread(file_path.write_bytes, file_data)

    @staticmethod
    async def read_file(file_path: Path):
        return await asyncio.to_thread(file_path.read_bytes)

    @staticmethod
    async def delete_file(file_path: Path) -> None:
        await asyncio.to_thread(file_path.unlink, missing_ok=True)

    @staticmethod
    async def file_exists(file_path: Path) -> bool:
        return await asyncio.to_thread(lambda: file_path.exists() and file_path.is_file())

    @staticmethod
    async def check_file_size(file_path: Path) -> int:
        return await asyncio.to_thread(lambda: file_path.stat().st_size)

    async def archive_files(self, files_paths: list[Path]):
        def build_archive():
            aggregate_size = sum(
                file_path.stat().st_size
                for file_path in files_paths
                if file_path.exists() and file_path.is_file()
            )
            max_size = generic_settings.MAX_ARCHIVE_SIZE_MB * 1024 * 1024
            if aggregate_size > max_size:
                raise FIleToBig(
                    file_type_name="archive",
                    size_limit=generic_settings.MAX_ARCHIVE_SIZE_MB,
                )
            zip_buffer = tempfile.SpooledTemporaryFile(
                max_size=8 * 1024 * 1024,
                mode="w+b",
            )
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
                for file_path in files_paths:
                    if file_path.exists() and file_path.is_file():
                        zip_file.write(file_path, arcname=file_path.name)
            zip_buffer.seek(0)
            return zip_buffer

        async with archive_semaphore:
            return await asyncio.to_thread(build_archive)

    @staticmethod
    async def file_chunk_generator(file_paths: list[Path]):
        chunk_size = generic_settings.CHUNK_SIZE * 1024 * 1024
        for file_path in file_paths:
            with open(file_path, "rb") as f:
                while chunk := await asyncio.to_thread(f.read, chunk_size):
                    yield chunk

    @staticmethod
    async def range_file_chunk_generator(file_path: Path, start_byte: int, end_byte: int):
        chunk_size = generic_settings.CHUNK_SIZE * 1024 * 1024
        remaining = end_byte - start_byte + 1
        with open(file_path, "rb") as f:
            await asyncio.to_thread(f.seek, start_byte)
            while remaining:
                chunk = await asyncio.to_thread(f.read, min(chunk_size, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    @staticmethod
    async def calculate_file_size(file: bytes) -> float:
        file_size_mb = len(file) / (1024 * 1024)
        return file_size_mb

    @staticmethod
    async def validate_file_size(
            file_size: float,
            max_allowed_file_size:
            Union[
                generic_settings.MAX_UPLOAD_IMAGE_SIZE,
                generic_settings.MAX_UPLOAD_VIDEO_SIZE,
                generic_settings.MAX_UPLOAD_AUDIO_SIZE,
                generic_settings.MAX_UPLOAD_FILE_SIZE
            ]
    ) -> bool:
        if file_size > max_allowed_file_size:
            return False

        return True

    @staticmethod
    async def validate_file_integrity(
            file: bytes,
            file_type:
            Union[
                Literal[
                    MessagesTypes.IMAGE,
                    MessagesTypes.VIDEO,
                    MessagesTypes.AUDIO,
                    MessagesTypes.FILE
                ]
            ]
    ) -> bool:
        match file_type:
            case MessagesTypes.IMAGE:
                try:
                    image = Image.open(BytesIO(file))
                    image.verify()
                except Exception as e:
                    print(e)
                    return False
            case MessagesTypes.VIDEO:
                return (
                    file.startswith(b"\x1a\x45\xdf\xa3")
                    or file.startswith(b"FLV")
                    or (file.startswith(b"RIFF") and file[8:12] == b"AVI ")
                    or file.startswith(b"\x00\x00\x01")
                    or (len(file) >= 12 and file[4:8] == b"ftyp")
                    or file.startswith(b"OggS")
                )
            case MessagesTypes.AUDIO:
                return (
                    file.startswith((b"ID3", b"fLaC", b"OggS", b"MThd"))
                    or file[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xf1", b"\xff\xf9")
                    or (file.startswith(b"RIFF") and file[8:12] == b"WAVE")
                    or file.startswith(b"\x1a\x45\xdf\xa3")
                    or (len(file) >= 12 and file[4:8] == b"ftyp")
                )
            case MessagesTypes.FILE:
                return True

        return True

    @staticmethod
    async def validate_file_type(
            file_type: str | None,
            allowed_file_type
    ) -> bool:
        if file_type not in allowed_file_type:
            return False

        return True

    @staticmethod
    async def _get_allowed_types(
            file_type_filter:
            Union[
                Literal[
                    MessagesTypes.IMAGE,
                    MessagesTypes.VIDEO,
                    MessagesTypes.AUDIO,
                    MessagesTypes.FILE
                ]
            ]) -> list:
        match file_type_filter:
            case MessagesTypes.IMAGE:
                return generic_settings.ALLOWED_IMAGE_TYPES
            case MessagesTypes.VIDEO:
                return generic_settings.ALLOWED_VIDEO_TYPES
            case MessagesTypes.AUDIO:
                return generic_settings.ALLOWED_AUDIO_TYPES
            case MessagesTypes.FILE:
                return list()

    @staticmethod
    async def _get_max_upload_size(
            file_type_filter:
            Union[
                Literal[
                    MessagesTypes.IMAGE,
                    MessagesTypes.VIDEO,
                    MessagesTypes.AUDIO,
                    MessagesTypes.FILE
                ]
            ]) -> int:
        match file_type_filter:
            case MessagesTypes.IMAGE:
                return generic_settings.MAX_UPLOAD_IMAGE_SIZE
            case MessagesTypes.VIDEO:
                return generic_settings.MAX_UPLOAD_VIDEO_SIZE
            case MessagesTypes.AUDIO:
                return generic_settings.MAX_UPLOAD_AUDIO_SIZE
            case MessagesTypes.FILE:
                return generic_settings.MAX_UPLOAD_FILE_SIZE

    @staticmethod
    async def _get_integrity_exception(
            file_type_filter:
            Union[
                Literal[
                    MessagesTypes.IMAGE,
                    MessagesTypes.VIDEO,
                    MessagesTypes.AUDIO,
                    MessagesTypes.FILE
                ]
            ]) -> Exception:
        match file_type_filter:
            case MessagesTypes.IMAGE:
                return ImageCorrupted()
            case MessagesTypes.VIDEO:
                return InvalidFileType(
                    file_type_name=file_type_filter.value,
                    file_types=", ".join(await StorageUtils._get_allowed_types(file_type_filter)),
                )
            case MessagesTypes.AUDIO:
                return InvalidFileType(
                    file_type_name=file_type_filter.value,
                    file_types=", ".join(await StorageUtils._get_allowed_types(file_type_filter)),
                )
            case MessagesTypes.FILE:
                return InvalidFileType(file_type_name="file", file_types="valid binary files")

    async def validate_file(
            self,
            file_content: bytes,
            file_type: str,
            file_type_filter:
            Union[
                Literal[
                    MessagesTypes.IMAGE,
                    MessagesTypes.VIDEO,
                    MessagesTypes.AUDIO,
                    MessagesTypes.FILE
                ]
            ]
    ) -> None:

        actual_file_type = await self.detect_file_type(file_type=file_type)
        if actual_file_type != file_type_filter:
            raise InvalidFileType(
                file_type_name=file_type_filter.value,
                file_types=', '.join(await self._get_allowed_types(file_type_filter))
            )

        file_size_mb = await self.calculate_file_size(file=file_content)
        if not await self.validate_file_size(file_size=file_size_mb,
                                             max_allowed_file_size=await self._get_max_upload_size(file_type_filter)):
            raise FIleToBig(
                file_type_name=file_type_filter.value,
                size_limit=await self._get_max_upload_size(file_type_filter)
            )

        if not (await self.validate_file_integrity(file=file_content, file_type=actual_file_type)):
            raise await self._get_integrity_exception(file_type_filter)

    async def detect_file_type(
            self,
            file_type: str)\
            -> Union[Literal[MessagesTypes.IMAGE, MessagesTypes.VIDEO, MessagesTypes.AUDIO, MessagesTypes.FILE]]:

        normalized_type = (file_type or "application/octet-stream").split(";", 1)[0].strip().lower()
        if await self.validate_file_type(file_type=normalized_type, allowed_file_type=generic_settings.ALLOWED_IMAGE_TYPES):
            return MessagesTypes.IMAGE
        elif await self.validate_file_type(file_type=normalized_type, allowed_file_type=generic_settings.ALLOWED_VIDEO_TYPES):
            return MessagesTypes.VIDEO
        elif await self.validate_file_type(file_type=normalized_type, allowed_file_type=generic_settings.ALLOWED_AUDIO_TYPES):
            return MessagesTypes.AUDIO
        else:
            return MessagesTypes.FILE
