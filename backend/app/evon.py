import json
import re
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from app.settings import settings

router = APIRouter(prefix="/api/voice", tags=["voice"])

Intent = Literal[
    "CUSTOMER_UNREACHABLE", "WRONG_ADDRESS", "RESCHEDULE_REQUESTED",
    "DELIVERY_COMPLETED", "NEXT_STOP_QUERY", "REPEAT_ADDRESS",
    "RUN_PROGRESS_QUERY", "COMPLETED_STOPS_QUERY", "CURRENT_STOP_QUERY",
    "ACCESS_NOTES_QUERY", "RUN_STATUS_QUERY", "CALL_CUSTOMER",
    "NAVIGATE_TO_STOP", "GENERAL_QUESTION", "UNCLEAR",
]

ACTION_BY_INTENT: dict[str, str | None] = {
    "CUSTOMER_UNREACHABLE": "contact_attempt", "WRONG_ADDRESS": "wrong_address",
    "RESCHEDULE_REQUESTED": "reschedule", "DELIVERY_COMPLETED": "delivered",
    "CALL_CUSTOMER": "call_customer", "NAVIGATE_TO_STOP": "directions",
}


class UnderstandRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=1000)
    language: str | None = None
    current_stop_summary: str | None = Field(default=None, max_length=1000)
    run_context: str | None = Field(default=None, max_length=3000)
    conversation_history: list[dict[str, str]] = Field(default_factory=list, max_length=8)


class UnderstandResult(BaseModel):
    intent: Intent
    confidence: float = Field(ge=0, le=1)
    extracted_details: dict[str, str] = Field(default_factory=dict)
    response_text: str = Field(min_length=1, max_length=600)


def _completion_url(base: str) -> str:
    clean = base.rstrip("/")
    return clean if clean.endswith("/chat/completions") else f"{clean}/chat/completions"


def _system_prompt() -> str:
    return (
        "You are Sarthi, a concise, kind, voice-first co-pilot for an e-commerce delivery rider in India. "
        "Understand the rider's request naturally, including Hinglish and multilingual speech. Respond in "
        "the same language/script and code-mixing style as the rider. Answer general questions helpfully, "
        "but distinguish general knowledge from facts about this run: only use supplied run context for "
        "orders, addresses, customers, OTPs, and status. Never invent those facts. For delivery workflows "
        "choose exactly one intent from: CUSTOMER_UNREACHABLE, WRONG_ADDRESS, RESCHEDULE_REQUESTED, "
        "DELIVERY_COMPLETED, NEXT_STOP_QUERY, REPEAT_ADDRESS, RUN_PROGRESS_QUERY, COMPLETED_STOPS_QUERY, "
        "CURRENT_STOP_QUERY, ACCESS_NOTES_QUERY, RUN_STATUS_QUERY, CALL_CUSTOMER, NAVIGATE_TO_STOP, "
        "GENERAL_QUESTION, UNCLEAR. DELIVERY_COMPLETED means the rider says delivery is done; never claim "
        "it was saved or verified. For actions, say that you can do it and ask for confirmation. Delivery "
        "completion always requires OTP verification by the app. Never encourage typing or interacting "
        "while the vehicle is moving; suggest pulling over safely. If user intent is genuinely unclear, ask "
        "one short follow-up. Return only JSON with intent, confidence (0..1), extracted_details (string map), "
        "response_text."
    )


@router.post("/understand", response_model=dict)
async def understand(body: UnderstandRequest) -> dict:
    parsed = await interpret_with_model(body)
    if parsed.confidence < 0.35:
        parsed.intent = "UNCLEAR"
    action = ACTION_BY_INTENT.get(parsed.intent)
    return {
        **parsed.model_dump(),
        "proposed_action": action,
        "requires_confirmation": action is not None,
        "understanding_engine": f"{settings.decision_provider}:{settings.groq_model if settings.decision_provider == 'groq' else settings.gemini_model}",
    }


async def interpret_with_model(body: UnderstandRequest) -> UnderstandResult:
    user_payload = {
        "transcript": body.transcript,
        "detected_language": body.language,
        "current_stop": body.current_stop_summary,
        "delivery_run_context": body.run_context,
    }
    history = [{"role": "system", "content": _system_prompt()}]
    for item in body.conversation_history[-8:]:
        role = "assistant" if item.get("role") == "assistant" else "user"
        history.append({"role": role, "content": str(item.get("content", ""))[:600]})
    history.append({"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)})

    provider = settings.decision_provider.casefold()
    if provider == "groq":
        if not settings.groq_api_key:
            raise HTTPException(status_code=503, detail="Add GROQ_API_KEY to backend/.env to enable Sarthi's decision model")
        url = _completion_url(settings.groq_base_url)
        headers = {"Authorization": f"Bearer {settings.groq_api_key}"}
        payload = {
            "model": settings.groq_model, "messages": history,
            "temperature": 0.2, "max_tokens": 350,
            "response_format": {"type": "json_object"},
        }
    elif provider == "gemini":
        if not settings.gemini_api_key:
            raise HTTPException(status_code=503, detail="Add GEMINI_API_KEY to backend/.env to enable Sarthi's decision model")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent?key={settings.gemini_api_key}"
        headers = {}
        contents = []
        for item in history[1:]:
            contents.append({"role": "model" if item["role"] == "assistant" else "user", "parts": [{"text": item["content"]}]})
        payload = {
            "systemInstruction": {"parts": [{"text": history[0]["content"]}]},
            "contents": contents,
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 350, "responseMimeType": "application/json"},
        }
    else:
        raise HTTPException(status_code=503, detail="DECISION_PROVIDER must be groq or gemini")

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach {provider.title()} decision model") from exc
    if response.is_error:
        raise HTTPException(status_code=502, detail=f"{provider.title()} decision request failed ({response.status_code}); check provider key, quota, and model")
    try:
        response_json = response.json()
        if provider == "groq":
            content = response_json["choices"][0]["message"]["content"]
        else:
            content = response_json["candidates"][0]["content"]["parts"][0]["text"]
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
        return UnderstandResult.model_validate_json(content)
    except (ValueError, KeyError, IndexError, TypeError, ValidationError) as exc:
        raise HTTPException(status_code=502, detail=f"{provider.title()} returned a response Sarthi could not interpret") from exc
