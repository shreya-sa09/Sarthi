# Sarthi in-app navigation setup

Sarthi renders its interactive map with MapLibre GL JS and OpenFreeMap's OpenStreetMap-compatible Liberty style. The backend can use GraphHopper for managed routing or a public OSM demo routing mode for local evaluation.

## Start spoken navigation without a GraphHopper key

Set `ROUTING_PROVIDER=osm_demo` in `backend/.env`, restart FastAPI, then start navigation from the map. Sarthi will look up the destination, request a road route and speak the initial direction and upcoming turns through the existing Timbre voice integration. Keep the page open and grant location permission.

This demo mode uses public Nominatim and OSRM services. Nominatim requires a descriptive User-Agent, caching, and no more than one request per second. Public demo services have no availability guarantee and are not suitable as a production fleet backend. OSRM's public route profile is for driving and does not provide live traffic or motorcycle-specific restrictions.

## Production routing

Set `ROUTING_PROVIDER=graphhopper` and `GRAPHHOPPER_API_KEY` in `backend/.env`, then restart FastAPI. Keep the key server-side; never use a `VITE_` variable. Confirm your provider plan includes the required quota and vehicle profile. For a production rider fleet, use a supported routing provider with motorcycle rules, traffic data where needed, capacity guarantees and operational monitoring.

OpenFreeMap's public tiles can render independently of route calculation. The browser must remain open in the foreground for continuous GPS guidance. Denied or inaccurate GPS, provider limits, and unavailable routes are surfaced as errors; Sarthi does not fabricate route geometry or turn instructions.