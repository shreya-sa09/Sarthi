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
    return Response(content=result.content, media_type="audio/wav")
