import json
import re
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import DeliveryRun
from app.settings import settings

router = APIRouter(prefix="/api/voice", tags=["voice"])

Intent = Literal[
    "CUSTOMER_UNREACHABLE", "WRONG_ADDRESS", "RESCHEDULE_REQUESTED",
    "DELIVERY_COMPLETED", "NEXT_STOP_QUERY", "REPEAT_ADDRESS",
    "RUN_PROGRESS_QUERY", "COMPLETED_STOPS_QUERY", "CURRENT_STOP_QUERY",
    "ACCESS_NOTES_QUERY", "RUN_STATUS_QUERY", "CALL_CUSTOMER",
    "NAVIGATE_TO_STOP", "PARCEL_QUERY", "PAYMENT_QUERY", "NEXT_ACTION_QUERY",
    "DELIVERY_INSTRUCTIONS_QUERY", "REPEAT_RESPONSE", "STOP_NAVIGATION", "CANCEL_NAVIGATION",
    "PAUSE_NAVIGATION", "RESUME_NAVIGATION", "REPEAT_DIRECTIONS", "CURRENT_TURN_QUERY",
    "REMAINING_ROUTE_QUERY", "GENERAL_QUESTION", "UNCLEAR",
]

ACTION_BY_INTENT: dict[str, str | None] = {
    "CUSTOMER_UNREACHABLE": "contact_attempt", "WRONG_ADDRESS": "wrong_address",
    "RESCHEDULE_REQUESTED": "reschedule", "DELIVERY_COMPLETED": "delivered",
    "CALL_CUSTOMER": "call_customer", "NAVIGATE_TO_STOP": "directions",
}


class UnderstandRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=1000)
    language: str | None = None
    selected_stop_id: int | None = Field(default=None, gt=0)
    current_stop_summary: str | None = Field(default=None, max_length=1000)
    run_context: str | None = Field(default=None, max_length=3000)
    conversation_history: list[dict[str, str]] = Field(default_factory=list, max_length=12)


class UnderstandResult(BaseModel):
    intent: Intent
    confidence: float = Field(ge=0, le=1)
    extracted_details: dict[str, str] = Field(default_factory=dict)
    response_text: str = Field(min_length=1, max_length=600)


def build_delivery_context(run: DeliveryRun, selected_stop_id: int | None) -> tuple[str, str]:
    ordered_stops = sorted(run.stops, key=lambda stop: (stop.sequence, stop.id))
    selected = next((stop for stop in ordered_stops if stop.id == selected_stop_id and stop.status != "delivered"), None)
    pending = [stop for stop in ordered_stops if stop.status == "pending"]
    active = pending[0] if pending else None
    next_pending = pending[1] if len(pending) > 1 else None
    context_fields = (
        "id", "sequence", "order_number", "customer_name", "address", "access_note",
        "parcel_description", "package_category", "weight_kg", "payment_type", "cod_amount",
        "delivery_window", "status", "exception_reason",
    )

    def safe_stop(stop):
        return {field: getattr(stop, field) for field in context_fields}

    selected = selected or active
    context = {
        "rider_name": run.rider_name,
        "run_status": run.status,
        "selected_delivery": safe_stop(selected) if selected else None,
        "active_delivery": safe_stop(active) if active else None,
        "next_pending_delivery": safe_stop(next_pending) if next_pending else None,
        "completed_count": sum(stop.status == "delivered" for stop in ordered_stops),
        "remaining_count": sum(stop.status != "delivered" for stop in ordered_stops),
        "total_count": len(ordered_stops),
        "deliveries": [safe_stop(stop) for stop in ordered_stops],
    }
    return json.dumps(context["selected_delivery"], ensure_ascii=False), json.dumps(context, ensure_ascii=False)


def _completion_url(base: str) -> str:
    clean = base.rstrip("/")
    return clean if clean.endswith("/chat/completions") else f"{clean}/chat/completions"


def _system_prompt() -> str:
    return (
        "You are Sarthi, a concise, kind, voice-first co-pilot for an e-commerce delivery rider in India. "
        "Understand the rider's request naturally, including Hindi, Hinglish, English, and multilingual speech. "
        "Respond in the same language and script as the latest rider message; if they use Hinglish, respond in "
        "natural Hinglish, and never switch to Hindi or English merely because a default language is configured. "
        "Answer general questions helpfully, "
        "but distinguish general knowledge from facts about this run: only use supplied run context for "
        "orders, addresses, customers, OTPs, and status. Never invent those facts. For delivery workflows "
        "treat NAVIGATE_TO_STOP as an immediate in-app route request only when the rider explicitly asks "
        "to go, open directions, or show the route. Questions asking who the customer is, "
        "where the address is, what the next delivery is, or what to do next are informational and must not "
        "use NAVIGATE_TO_STOP. Delivery completion, OTP verification, and selecting a next delivery never "
        "imply navigation. If the rider says only yes, confirm the pending proposal only when the immediately "
        "preceding rider turn asked for confirmation; otherwise ask what they mean. Do not repeat or execute "
        "a previous intent based on assistant history. Resolve follow-up pronouns from the latest rider turns "
        "and selected delivery, and ask a short clarification if multiple targets remain plausible. "
        "choose exactly one intent from: CUSTOMER_UNREACHABLE, WRONG_ADDRESS, RESCHEDULE_REQUESTED, "
        "DELIVERY_COMPLETED, NEXT_STOP_QUERY, REPEAT_ADDRESS, RUN_PROGRESS_QUERY, COMPLETED_STOPS_QUERY, "
        "CURRENT_STOP_QUERY, ACCESS_NOTES_QUERY, RUN_STATUS_QUERY, CALL_CUSTOMER, NAVIGATE_TO_STOP, "
        "PARCEL_QUERY, PAYMENT_QUERY, NEXT_ACTION_QUERY, DELIVERY_INSTRUCTIONS_QUERY, REPEAT_RESPONSE, "
        "STOP_NAVIGATION, CANCEL_NAVIGATION, PAUSE_NAVIGATION, RESUME_NAVIGATION, REPEAT_DIRECTIONS, "
        "CURRENT_TURN_QUERY, REMAINING_ROUTE_QUERY, GENERAL_QUESTION, UNCLEAR. DELIVERY_COMPLETED means the rider says delivery is done; never claim "
        "it was saved or verified. Delivery completion always requires OTP verification by the app. "
        "For consequential actions, say what will happen and ask for confirmation. An explicit navigation request itself "
        "authorizes opening directions and must not ask for a second confirmation. Other consequential "
        "actions still need confirmation. Never encourage typing or interacting "
        "while the vehicle is moving; suggest pulling over safely. If user intent is genuinely unclear, ask "
        "one short follow-up. For navigation controls, distinguish stopping the assistant speech from stopping, "
        "pausing, or resuming the active route. Classify requests about the current turn and remaining route distance "
        "as CURRENT_TURN_QUERY and REMAINING_ROUTE_QUERY; never invent route details. Return only JSON with intent, confidence (0..1), extracted_details (string map), "
        "response_text."
    )


@router.post("/understand", response_model=dict)
async def understand(body: UnderstandRequest, db: Session = Depends(get_db)) -> dict:
    run = db.scalar(
        select(DeliveryRun)
        .where(DeliveryRun.status == "active")
        .options(selectinload(DeliveryRun.stops))
        .order_by(DeliveryRun.id.desc())
    )
    if run is None:
        raise HTTPException(status_code=404, detail="No active delivery run")

    current_summary, run_context = build_delivery_context(run, body.selected_stop_id)
    parsed = await interpret_with_model(body, current_summary, run_context)
    if parsed.confidence < 0.35:
        parsed.intent = "UNCLEAR"
    action = ACTION_BY_INTENT.get(parsed.intent)
    return {
        **parsed.model_dump(),
        "proposed_action": action,
        "requires_confirmation": action is not None and parsed.intent != "NAVIGATE_TO_STOP",
        "understanding_engine": f"{settings.decision_provider}:{settings.groq_model if settings.decision_provider == 'groq' else settings.gemini_model}",
    }


async def interpret_with_model(body: UnderstandRequest, current_stop: str, run_context: str) -> UnderstandResult:
    user_payload = {
        "transcript": body.transcript,
        "detected_language": body.language,
        "current_stop": current_stop,
        "delivery_run_context": run_context,
    }
    history = [{"role": "system", "content": _system_prompt()}]
    for item in body.conversation_history[-12:]:
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
