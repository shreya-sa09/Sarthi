# Sarthi in-app navigation setup

Sarthi renders its interactive map with MapLibre GL JS and OpenFreeMap tiles. GraphHopper provides address lookup and road routes.

## Configure routing

Set `GRAPHHOPPER_API_KEY` in `backend/.env`, then restart FastAPI. Keep the key server-side; never use a `VITE_` variable. Confirm your provider plan includes the required quota and vehicle profile.

The browser must remain open in the foreground for continuous GPS guidance. Allow location access when prompted. Denied or inaccurate GPS, provider limits, and unavailable routes are surfaced as errors; Sarthi does not fabricate route geometry or turn instructions.
