import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.settings import settings

router = APIRouter(prefix="/api/voice", tags=["voice"])


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    language: str = "hi-IN"


def require_gnani_key() -> str:
    if not settings.gnani_api_key:
        raise HTTPException(status_code=503, detail="Gnani API key is not configured on the server")
    return settings.gnani_api_key


def normalize_wav_lengths(audio: bytes) -> bytes:
    if len(audio) < 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise HTTPException(status_code=502, detail="Gnani returned a malformed WAV audio response")

    normalized = bytearray(audio)
    riff_length = int.from_bytes(normalized[4:8], "little")
    if riff_length == 0xFFFFFFFF:
        normalized[4:8] = (len(normalized) - 8).to_bytes(4, "little")

    offset = 12
    has_format = False
    data_found = False
    while offset + 8 <= len(normalized):
        chunk_name = normalized[offset:offset + 4]
        chunk_length = int.from_bytes(normalized[offset + 4:offset + 8], "little")
        data_start = offset + 8
        if chunk_name == b"fmt ":
            has_format = chunk_length >= 16 and data_start + min(chunk_length, 16) <= len(normalized)
        if chunk_name == b"data":
            actual_length = len(normalized) - data_start
            if actual_length <= 0:
                raise HTTPException(status_code=502, detail="Gnani returned an empty WAV audio response")
            if chunk_length == 0xFFFFFFFF:
                normalized[offset + 4:offset + 8] = actual_length.to_bytes(4, "little")
            elif chunk_length > actual_length:
                raise HTTPException(status_code=502, detail="Gnani returned a truncated WAV audio response")
            data_found = True
            break
        if chunk_length == 0xFFFFFFFF:
            break
        offset = data_start + chunk_length + (chunk_length & 1)

    if not has_format or not data_found:
        raise HTTPException(status_code=502, detail="Gnani returned an unsupported WAV audio response")
    return bytes(normalized)


@router.post("/transcribe")
async def transcribe(audio_file: UploadFile = File(...)) -> dict:
    api_key = require_gnani_key()
    audio = await audio_file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="Audio recording is empty")
    if len(audio) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Recording is too large")

    filename = audio_file.filename or "recording.wav"
    content_type = audio_file.content_type or "audio/wav"
    form = {
        "model": settings.prisma_model,
        "language_code": "indic-auto",
        "format": "codemix",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            result = await client.post(
                f"{settings.gnani_base_url.rstrip('/')}/stt/v3",
                headers={"X-API-Key-ID": api_key},
                data=form,
                files={"audio_file": (filename, audio, content_type)},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Gnani speech recognition") from exc
    if result.is_error:
        raise HTTPException(status_code=502, detail=f"Gnani transcription failed ({result.status_code})")
    payload = result.json()
    return {
        "transcript": payload.get("transcript", ""),
        "detected_language_code": payload.get("detected_language_code"),
        "model": payload.get("model", settings.prisma_model),
        "request_id": payload.get("request_id"),
    }


@router.post("/speak")
async def speak(body: SpeakRequest) -> Response:
    api_key = require_gnani_key()
    payload = {
        "text": body.text,
        "model": settings.timbre_model,
        "voice": settings.timbre_voice,
        "language": body.language,
        "speed": 1.0,
        "audio_config": {
            "sample_rate": 24000,
            "num_channels": 1,
            "sample_width": 2,
            "encoding": "linear_pcm",
            "container": "wav",
        },
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            result = await client.post(
                f"{settings.gnani_base_url.rstrip('/')}/api/v1/tts/inference",
                headers={"X-API-Key-ID": api_key},
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Gnani speech generation") from exc
    if result.is_error:
        raise HTTPException(status_code=502, detail=f"Gnani speech generation failed ({result.status_code})")
    content_type = result.headers.get("content-type", "").split(";", maxsplit=1)[0].strip().lower()
    if content_type and content_type not in {"audio/wav", "audio/x-wav", "application/octet-stream"}:
        raise HTTPException(status_code=502, detail="Gnani returned an unsupported audio format")
    return Response(content=normalize_wav_lengths(result.content), media_type="audio/wav")
