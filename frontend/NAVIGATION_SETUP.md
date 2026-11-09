# Sarthi in-app navigation setup

Sarthi renders its interactive map with MapLibre GL JS and OpenFreeMap's OpenStreetMap-compatible Liberty style. Address lookup and road routing run through FastAPI using GraphHopper; the GraphHopper key is never sent to the browser.

## Configure routing

1. Create an API key from your GraphHopper account at [GraphHopper](https://www.graphhopper.com/).
2. Add `GRAPHHOPPER_API_KEY=your_key_here` to `backend/.env` (copy `backend/.env.example` first if needed). Do not add this key to any `VITE_` variable or frontend file.
3. Restart FastAPI after changing the environment.
4. Start the frontend and open Map. Tiles can render without an API key; address lookup and route calculation require the GraphHopper key.
5. Allow location access in the browser and start navigation. Localhost is a secure context for development; deployed sites need HTTPS.

GraphHopper applies plan-specific quotas and profile restrictions. Check the current plan and usage limits in your account before using it. OpenFreeMap's public tile service currently documents free use without an API key or request quota, but it is provided without a service-level availability guarantee. For a production fleet, select a tile plan with appropriate support and capacity.

The browser must remain open in the foreground for continuous GPS guidance. Denied or inaccurate GPS, missing routing configuration, provider quota limits, and unavailable routes are surfaced as errors; Sarthi does not fabricate route geometry or turn instructions. The route profile is GraphHopper's `car` profile and is not guaranteed to be motorcycle-specific or traffic-aware.
