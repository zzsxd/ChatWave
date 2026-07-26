import asyncio
from pathlib import Path
from threading import Lock

from fastapi import HTTPException, status

from repository import select_message, update_voice_transcript
from schemas import VoiceTranscription
from storage import FileManager
from utilities import (
    FileNotFound,
    MediaPatches,
    MessageNotFound,
    MessagesTypes,
    generic_settings,
)
from validators import validate_user_have_access_to_message


_model = None
_model_init_lock = Lock()
_transcription_gate = asyncio.Lock()


def _load_model():
    global _model
    if _model is not None:
        return _model
    with _model_init_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            cache_dir = generic_settings.MEDIA_FOLDER / "models" / "whisper"
            cache_dir.mkdir(parents=True, exist_ok=True)
            _model = WhisperModel(
                generic_settings.TRANSCRIPTION_MODEL,
                device="cpu",
                compute_type=generic_settings.TRANSCRIPTION_COMPUTE_TYPE,
                cpu_threads=2,
                num_workers=1,
                download_root=str(cache_dir),
            )
    return _model


def _transcribe_file(file_path: Path) -> tuple[str, str | None]:
    model = _load_model()
    segments, info = model.transcribe(
        str(file_path),
        beam_size=3,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    return text[:32_000], getattr(info, "language", None)


async def transcribe_voice_message(
    user_id: int,
    message_id: int,
) -> VoiceTranscription:
    await validate_user_have_access_to_message(
        user_id=user_id,
        message_id=message_id,
    )
    message = await select_message(message_id)
    if message is None:
        raise MessageNotFound()
    if (
        message.type != MessagesTypes.VOICE
        or message.file_content_name is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Расшифровка доступна только для голосовых сообщений",
        )
    if message.voice_transcript is not None:
        return VoiceTranscription(
            text=message.voice_transcript,
            language=message.transcript_language,
            cached=True,
        )

    max_size = generic_settings.MAX_TRANSCRIPTION_AUDIO_SIZE_MB * 1024 * 1024
    if (message.file_size or 0) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                "Голосовое сообщение слишком большое для расшифровки "
                f"(максимум {generic_settings.MAX_TRANSCRIPTION_AUDIO_SIZE_MB} МБ)"
            ),
        )
    file_path = (
        MediaPatches.MEDIA_MESSAGES_FOLDER.value / message.file_content_name
    )
    if not await FileManager().file_exists(file_path):
        raise FileNotFound()

    try:
        await asyncio.wait_for(_transcription_gate.acquire(), timeout=3)
    except TimeoutError as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Сервис уже расшифровывает другое сообщение",
        ) from error

    try:
        current = await select_message(message_id)
        if current is not None and current.voice_transcript is not None:
            return VoiceTranscription(
                text=current.voice_transcript,
                language=current.transcript_language,
                cached=True,
            )
        try:
            transcript, language = await asyncio.to_thread(
                _transcribe_file,
                file_path,
            )
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Не удалось распознать голосовое сообщение",
            ) from error
        if not transcript:
            transcript = "Речь не распознана"
        await update_voice_transcript(message_id, transcript, language)
        return VoiceTranscription(
            text=transcript,
            language=language,
            cached=False,
        )
    finally:
        _transcription_gate.release()
