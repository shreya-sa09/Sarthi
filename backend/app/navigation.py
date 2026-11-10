from __future__ import annotations

from threading import Lock
from time import monotonic, sleep

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.settings import settings

router = APIRouter(prefix="/api/navigation", tags=["navigation"])
BASE_URL = "https://graphhopper.com/api/1"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OSM_USER_AGENT = "SarthiDelivery/0.1 (voice navigation demo)"
_geocode_cache: dict[str, dict[str, float | str]] = {}
_geocode_lock = Lock()
_last_nominatim_request = 0.0


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


def _geocode_osm(query: str) -> dict[str, float | str]:
    global _last_nominatim_request
    cache_key = " ".join(query.casefold().split())
    with _geocode_lock:
        if cache_key in _geocode_cache:
            return _geocode_cache[cache_key]
        wait = 1.05 - (monotonic() - _last_nominatim_request)
        if wait > 0:
            sleep(wait)
        try:
            with httpx.Client(timeout=15, headers={"User-Agent": OSM_USER_AGENT}) as client:
                response = client.get(NOMINATIM_URL, params={"q": query, "format": "jsonv2", "limit": 1, "countrycodes": "in"})
                _last_nominatim_request = monotonic()
                response.raise_for_status()
            results = response.json()
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 429:
                raise HTTPException(status_code=429, detail="OpenStreetMap geocoding is busy. Wait a moment and retry.") from error
            raise HTTPException(status_code=502, detail="OpenStreetMap address lookup failed. Please retry.") from error
        except (httpx.RequestError, ValueError) as error:
            raise HTTPException(status_code=502, detail="OpenStreetMap address lookup is unavailable. Check your connection and retry.") from error
        if not results:
            raise HTTPException(status_code=422, detail="The saved delivery address could not be located. Review the address before navigating.")
        result = results[0]
        try:
            point = {"latitude": float(result["lat"]), "longitude": float(result["lon"]), "label": result.get("display_name") or query}
        except (KeyError, TypeError, ValueError) as error:
            raise HTTPException(status_code=502, detail="OpenStreetMap returned an invalid location result.") from error
        if len(_geocode_cache) >= 500:
            _geocode_cache.clear()
        _geocode_cache[cache_key] = point
        return point


def _osrm_instruction(step: dict) -> dict:
    maneuver = step.get("maneuver") or {}
    maneuver_type = str(maneuver.get("type") or "continue")
    modifier = str(maneuver.get("modifier") or "")
    name = str(step.get("name") or "").strip()
    ref = str(step.get("ref") or "").strip()
    road = name or ref
    road_suffix = f" onto {road}" if road and maneuver_type in {"turn", "fork", "merge", "on ramp", "off ramp", "end of road"} else (f" on {road}" if road else "")
    direction = modifier.replace("_", " ")
    if maneuver_type == "arrive":
        text = "You have arrived at your delivery destination."
    elif maneuver_type in {"roundabout", "rotary", "roundabout turn"}:
        exit_number = maneuver.get("exit")
        text = f"At the roundabout, take exit {exit_number}{road_suffix}." if exit_number else f"At the roundabout, continue{road_suffix}."
    elif maneuver_type == "depart":
        text = f"Start{road_suffix or ' along the route'} and continue ahead."
    elif maneuver_type == "turn":
        text = f"Turn {direction or 'ahead'}{road_suffix}."
    elif maneuver_type == "end of road":
        text = f"At the end of the road, turn {direction or 'ahead'}{road_suffix}."
    elif maneuver_type == "fork":
        text = f"At the fork, keep {direction or 'straight'}{road_suffix}."
    elif maneuver_type == "merge":
        text = f"Merge {direction}{road_suffix}." if direction else f"Merge{road_suffix}."
    elif maneuver_type in {"on ramp", "off ramp"}:
        text = f"Take the {maneuver_type}{road_suffix}."
    else:
        text = f"Continue{road_suffix or ' along the route'}."

    sign = -2 if "left" in direction else 2 if "right" in direction else -98 if "uturn" in direction or "u-turn" in direction else 0
    step_geometry = (step.get("geometry") or {}).get("coordinates") or []
    location = maneuver.get("location") or (step_geometry[-1] if step_geometry else None)
    if not location:
        raise HTTPException(status_code=502, detail="The routing service returned an instruction without a position.")
    return {
        "text": text,
        "distance_m": step.get("distance", 0),
        "duration_ms": float(step.get("duration", 0)) * 1000,
        "sign": sign,
        "street_name": road,
        "position": location,
    }


@router.get("/geocode")
def geocode(q: str):
    if not q.strip():
        raise HTTPException(status_code=422, detail="A delivery address is required.")
    if settings.routing_provider.casefold() == "osm_demo":
        return _geocode_osm(q.strip())
    key = _api_key()
    address = q.strip()
    parts = [part.strip() for part in address.split(",") if part.strip()]
    queries = [address]
    if len(parts) >= 4:
        queries.append(", ".join(parts[1:]))
    if len(parts) >= 3:
        queries.append(", ".join(parts[-3:]))
    if len(parts) >= 2:
        queries.append(", ".join(parts[-2:]))
    try:
        with httpx.Client(timeout=12) as client:
            hits = []
            matched_query = address
            for candidate in dict.fromkeys(queries):
                response = client.get(f"{BASE_URL}/geocode", params={"q": candidate, "locale": "en", "limit": 1, "key": key})
                response.raise_for_status()
                hits = response.json().get("hits", [])
                if hits and hits[0].get("point"):
                    matched_query = candidate
                    break
    except httpx.HTTPStatusError as error:
        raise _provider_error(error) from error
    except (httpx.RequestError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Location lookup is temporarily unavailable. Check your connection and retry.") from error
    if not hits or not hits[0].get("point"):
        raise HTTPException(status_code=422, detail="The saved delivery address could not be located. Review the address before navigating.")
    point = hits[0]["point"]
    matched_name = hits[0].get("name") or matched_query
    building_hint = parts[0].casefold() if parts else ""
    approximate = matched_query != address or bool(building_hint and building_hint not in str(matched_name).casefold())
    return {
        "latitude": point["lat"],
        "longitude": point["lng"],
        "label": matched_name,
        "approximate": approximate,
    }


@router.post("/route")
def calculate_route(data: RouteRequest):
    language = "hi" if data.language.lower().startswith("hi") else "en"
    if settings.routing_provider.casefold() == "osm_demo":
        coordinates = f"{data.origin.longitude},{data.origin.latitude};{data.destination.longitude},{data.destination.latitude}"
        try:
            with httpx.Client(timeout=25, headers={"User-Agent": OSM_USER_AGENT}) as client:
                response = client.get(f"{OSRM_URL}/{coordinates}", params={"overview": "full", "geometries": "geojson", "steps": "true", "alternatives": "false"})
                response.raise_for_status()
            payload = response.json()
            routes = payload.get("routes") or []
            if payload.get("code") != "Ok" or not routes:
                raise HTTPException(status_code=422, detail="No road route is available for this destination.")
            route = routes[0]
            geometry = (route.get("geometry") or {}).get("coordinates") or []
            if len(geometry) < 2:
                raise HTTPException(status_code=502, detail="The routing service returned incomplete route geometry.")
            instructions = [
                _osrm_instruction(step)
                for leg in route.get("legs", [])
                for step in leg.get("steps", [])
            ]
            if not instructions:
                raise HTTPException(status_code=502, detail="The routing service returned no spoken turn instructions.")
            return {"geometry": geometry, "distance_m": route.get("distance"), "duration_ms": float(route.get("duration", 0)) * 1000, "instructions": instructions, "language": language}
        except HTTPException:
            raise
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 429:
                raise HTTPException(status_code=429, detail="The public routing demo is busy. Wait a moment and retry.") from error
            raise HTTPException(status_code=502, detail=f"OpenStreetMap routing failed (HTTP {error.response.status_code}). Please retry.") from error
        except (httpx.RequestError, ValueError, KeyError, TypeError) as error:
            raise HTTPException(status_code=502, detail="OpenStreetMap routing is temporarily unavailable. Check your connection and retry.") from error

    key = _api_key()
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
