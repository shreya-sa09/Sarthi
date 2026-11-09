from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.settings import settings

router = APIRouter(prefix="/api/navigation", tags=["navigation"])
BASE_URL = "https://graphhopper.com/api/1"


class Coordinates(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    origin: Coordinates
    destination: Coordinates
    language: str = "en"


def _api_key() -> str:
    if not settings.graphhopper_api_key.strip():
        raise HTTPException(status_code=503, detail="In-app routing is not configured. Add GRAPHHOPPER_API_KEY to the backend environment and restart FastAPI.")
    return settings.graphhopper_api_key.strip()


def _provider_error(error: httpx.HTTPStatusError) -> HTTPException:
    status = error.response.status_code
    if status == 429:
        return HTTPException(status_code=429, detail="GraphHopper route quota was reached. Try again later.")
    if status in (400, 404):
        return HTTPException(status_code=422, detail="GraphHopper could not find a route or location for these coordinates.")
    return HTTPException(status_code=502, detail=f"GraphHopper routing failed (HTTP {status}). Please retry.")


@router.get("/geocode")
def geocode(q: str):
    key = _api_key()
    if not q.strip():
        raise HTTPException(status_code=422, detail="A delivery address is required.")
    try:
        with httpx.Client(timeout=12) as client:
            response = client.get(f"{BASE_URL}/geocode", params={"q": q, "locale": "en", "limit": 1, "key": key})
            response.raise_for_status()
        hits = response.json().get("hits", [])
    except httpx.HTTPStatusError as error:
        raise _provider_error(error) from error
    except (httpx.RequestError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Location lookup is temporarily unavailable. Check your connection and retry.") from error
    if not hits or not hits[0].get("point"):
        raise HTTPException(status_code=422, detail="The saved delivery address could not be located. Review the address before navigating.")
    point = hits[0]["point"]
    return {"latitude": point["lat"], "longitude": point["lng"], "label": hits[0].get("name") or q}


@router.post("/route")
def calculate_route(data: RouteRequest):
    key = _api_key()
    language = "hi" if data.language.lower().startswith("hi") else "en"
    params = [
        ("point", f"{data.origin.latitude},{data.origin.longitude}"),
        ("point", f"{data.destination.latitude},{data.destination.longitude}"),
        ("profile", "car"), ("locale", language), ("instructions", "true"),
        ("calc_points", "true"), ("points_encoded", "false"), ("key", key),
    ]
    try:
        with httpx.Client(timeout=20) as client:
            response = client.get(f"{BASE_URL}/route", params=params)
            response.raise_for_status()
        payload = response.json()
        paths = payload.get("paths") or []
        if not paths:
            raise HTTPException(status_code=422, detail="No road route is available for this destination.")
        path = paths[0]
        coordinates = path.get("points", {}).get("coordinates") or []
        if len(coordinates) < 2:
            raise HTTPException(status_code=502, detail="The routing service returned incomplete route geometry.")
        raw_instructions = path.get("instructions") or []
        instructions = []
        for item in raw_instructions:
            interval = item.get("interval") or []
            end = min(max(int(interval[1]) if len(interval) > 1 else 0, 0), len(coordinates) - 1)
            instructions.append({
                "text": item.get("text") or "Continue along the route.",
                "distance_m": item.get("distance", 0),
                "duration_ms": item.get("time", 0),
                "sign": item.get("sign", 0),
                "street_name": item.get("street_name", ""),
                "position": coordinates[end],
            })
        return {"geometry": coordinates, "distance_m": path.get("distance"), "duration_ms": path.get("time"), "instructions": instructions, "language": language}
    except HTTPException:
        raise
    except httpx.HTTPStatusError as error:
        raise _provider_error(error) from error
    except (httpx.RequestError, ValueError, KeyError, TypeError) as error:
        raise HTTPException(status_code=502, detail="Route calculation is temporarily unavailable. Check your connection and retry.") from error
