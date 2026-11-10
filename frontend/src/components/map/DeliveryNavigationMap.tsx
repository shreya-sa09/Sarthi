import { useCallback, useEffect, useRef, useState } from 'react'
import { LngLatBounds, Map, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { LocateFixed, MapPin, Navigation, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
import { geocodeDeliveryAddress, getNavigationRoute, type GeoPoint, type NavigationRoute, type Stop } from '../../api'

setWorkerUrl(workerUrl)

type NavigationState = 'loading-map' | 'locating' | 'calculating' | 'active' | 'paused' | 'arrived' | 'error' | 'idle'
export type NavigationCommand = { action: 'pause' | 'resume' | 'repeat'; requestId: number } | null
export type NavigationSnapshot = { state: NavigationState; instruction: string; metersRemaining: number | null }
type Position = GeoPoint & { accuracy: number; heading: number | null; speed: number | null }
const DEMO_ORIGIN: GeoPoint = { latitude: 18.5018, longitude: 73.8636 } // Swargate, Pune

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const distanceBetween = (a: GeoPoint, b: GeoPoint) => {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
const bearingBetween = (a: GeoPoint, b: GeoPoint) => {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const y = Math.sin(radians(b.longitude - a.longitude)) * Math.cos(radians(b.latitude))
  const x = Math.cos(radians(a.latitude)) * Math.sin(radians(b.latitude)) - Math.sin(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.cos(radians(b.longitude - a.longitude))
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}
const formatDistance = (meters: number | null) => meters === null ? '—' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(meters))} m`

function localizeInstruction(instruction: NavigationRoute['instructions'][number] | undefined, language: string, distanceOverride?: number) {
  if (!instruction) return 'Continue along the route.'
  if (!language.toLowerCase().startsWith('hi')) return instruction.text
  const meters = Math.max(0, Math.round(distanceOverride ?? instruction.distance_m))
  const left = [-1, -2, -3, 7].includes(instruction.sign)
  const right = [1, 2, 3, 8].includes(instruction.sign)
  const uTurn = [-98, 98].includes(instruction.sign)
  if (/latn/i.test(language)) {
    const turn = uTurn ? 'U-turn lena hai' : left ? 'left turn lena hai' : right ? 'right turn lena hai' : 'seedha chalte rahiye'
    return meters > 0 ? `${meters} metres ke baad ${turn}.` : turn
  }
  const turn = uTurn ? 'यू-टर्न लें' : left ? 'बाईं ओर मुड़ें' : right ? 'दाईं ओर मुड़ें' : 'सीधे चलते रहें'
  return meters > 0 ? `${meters} मीटर बाद ${turn}` : turn
}

export function DeliveryNavigationMap({ stop, autoStart, stopSignal, command, language, onSnapshot, onGuidance, onNavigationStarted, onNavigationError }: {
  stop: Stop
  autoStart: boolean
  stopSignal: number
  command: NavigationCommand
  language: string
  onSnapshot: (snapshot: NavigationSnapshot) => void
  onGuidance: (instruction: string) => void
  onNavigationStarted: (instruction: string, metersRemaining: number | null) => void
  onNavigationError: (message: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const riderMarker = useRef<Marker | null>(null)
  const destinationMarker = useRef<Marker | null>(null)
  const destination = useRef<GeoPoint | null>(null)
  const route = useRef<NavigationRoute | null>(null)
  const routeRequest = useRef(0)
  const watchId = useRef<number | null>(null)
  const lastPosition = useRef<Position | null>(null)
  const smoothedHeading = useRef<number | null>(null)
  const routeProgress = useRef<number[]>([])
  const currentStep = useRef(0)
  const announced = useRef(new Set<number>())
  const deviationCount = useRef(0)
  const lastRecalculation = useRef(0)
  const handledCommand = useRef(0)
  const stopIdentity = useRef(stop.id)
  const guidanceRef = useRef(onGuidance)
  guidanceRef.current = onGuidance
  const navigationErrorRef = useRef(onNavigationError)
  navigationErrorRef.current = onNavigationError
  const navigationStartedRef = useRef(onNavigationStarted)
  navigationStartedRef.current = onNavigationStarted
  const [mapReady, setMapReady] = useState(false)
  const [destinationReady, setDestinationReady] = useState(false)
  const [destinationRetry, setDestinationRetry] = useState(0)
  const [mapRetry, setMapRetry] = useState(0)
  const [destinationError, setDestinationError] = useState(false)
  const [navigationState, setNavigationState] = useState<NavigationState>('loading-map')
  const [instruction, setInstruction] = useState('Preparing the map…')
  const [metersRemaining, setMetersRemaining] = useState<number | null>(null)
  const [durationRemaining, setDurationRemaining] = useState<number | null>(null)
  const [distanceToTurn, setDistanceToTurn] = useState<number | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [muted, setMuted] = useState(false)
  const [demoLocation, setDemoLocation] = useState(true)
  const [demoInstructionIndex, setDemoInstructionIndex] = useState(0)
  const [follow, setFollow] = useState(true)
  const [headingUp, setHeadingUp] = useState(true)
  const [message, setMessage] = useState('')
  const [completed, setCompleted] = useState(false)

  const publishSnapshot = useCallback((state: NavigationState, text: string, remaining: number | null) => {
    onSnapshot({ state, instruction: text, metersRemaining: remaining })
  }, [onSnapshot])

  useEffect(() => {
    publishSnapshot(navigationState, instruction, metersRemaining)
  }, [navigationState, instruction, metersRemaining, publishSnapshot])
  useEffect(() => () => onSnapshot({ state: 'idle', instruction: 'Navigation is inactive while the Map screen is closed.', metersRemaining: null }), [onSnapshot])

  useEffect(() => {
    if (!container.current) return
    const instance = new Map({ container: container.current, style: MAP_STYLE, center: [0, 0], zoom: 2, pitchWithRotate: true, dragRotate: true })
    instance.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    instance.on('load', () => { setMapReady(true); setNavigationState('idle'); setInstruction('Ready when you are.') })
    instance.on('error', (event: any) => {
      if (event.error) setMessage('Map tiles could not load. Check your internet connection and retry.')
    })
    instance.on('dragstart', () => setFollow(false))
    instance.on('rotatestart', () => { setFollow(false); setHeadingUp(false) })
    map.current = instance
    return () => { instance.remove(); map.current = null; setMapReady(false) }
  }, [mapRetry])

  useEffect(() => {
    if (!map.current || !mapReady) return
    let cancelled = false
    setDestinationReady(false)
    setDestinationError(false)
    setMessage('Locating the saved delivery address…')
    void geocodeDeliveryAddress(stop.address).then((point) => {
      if (cancelled || !map.current) return
      destination.current = point
      destinationMarker.current?.remove()
      const pin = document.createElement('div')
      pin.className = 'navigation-destination-marker'
      pin.setAttribute('aria-label', `Delivery destination for ${stop.customer_name}`)
      destinationMarker.current = new Marker({ element: pin, anchor: 'bottom' }).setLngLat([point.longitude, point.latitude]).addTo(map.current)
      map.current.easeTo({ center: [point.longitude, point.latitude], zoom: 14, duration: 700 })
      setDestinationReady(true)
      setMessage(point.approximate
        ? `Exact building not found. Using the nearby mapped area: ${point.label}. Follow the spoken directions, then confirm the exact building with the customer.`
        : 'Destination located from the saved delivery address.')
    }).catch((error: unknown) => {
      if (cancelled) return
      const detail = error instanceof Error ? error.message : 'Could not locate this saved address.'
      setDestinationReady(false); setDestinationError(true); setMessage(detail); navigationErrorRef.current(detail)
    })
    return () => { cancelled = true }
  }, [mapReady, stop.id, stop.address, stop.customer_name, destinationRetry])

  const renderRoute = useCallback((data: NavigationRoute) => {
    const instance = map.current
    if (!instance) return
    const feature = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: data.geometry } }
    const source = instance.getSource('sarthi-route') as GeoJSONSource | undefined
    if (source) source.setData(feature as GeoJSON.Feature<GeoJSON.LineString>)
    else {
      instance.addSource('sarthi-route', { type: 'geojson', data: feature as GeoJSON.Feature<GeoJSON.LineString> })
      instance.addLayer({ id: 'sarthi-route-casing', type: 'line', source: 'sarthi-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 11, 'line-opacity': 0.86 } })
      instance.addLayer({ id: 'sarthi-route-line', type: 'line', source: 'sarthi-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#6335C9', 'line-width': 7, 'line-opacity': 0.92 } })
    }
    const bounds = new LngLatBounds()
    data.geometry.forEach(([lng, lat]) => bounds.extend([lng, lat]))
    instance.fitBounds(bounds, { padding: { top: 110, bottom: 150, left: 48, right: 48 }, maxZoom: 16, duration: 800 })
  }, [])

  const calculateRoute = useCallback(async (origin: GeoPoint, initial: boolean, requestId: number) => {
    const target = destination.current
    if (!target) return
    setNavigationState('calculating')
    setMessage('Calculating an actual road route…')
    try {
      const result = await getNavigationRoute(origin, target, language)
      if (requestId !== routeRequest.current) return
      if (!result.geometry?.length || !result.instructions?.length) throw new Error('The routing service returned no usable road route. Please retry.')
      route.current = result
      routeProgress.current = [0]
      for (let i = 1; i < result.geometry.length; i++) {
        const [previousLng, previousLat] = result.geometry[i - 1]
        const [lng, lat] = result.geometry[i]
        routeProgress.current.push(routeProgress.current[i - 1] + distanceBetween({ latitude: previousLat, longitude: previousLng }, { latitude: lat, longitude: lng }))
      }
      currentStep.current = 0
      setDemoInstructionIndex(0)
      announced.current.clear()
      deviationCount.current = 0
      lastRecalculation.current = Date.now()
      renderRoute(result)
      const first = localizeInstruction(result.instructions[0], language)
      setInstruction(first)
      setMetersRemaining(result.distance_m)
      setDurationRemaining(result.duration_ms)
      setDistanceToTurn(null)
      setNavigationState('active')
      setFollow(true)
      setHeadingUp(true)
      if (demoLocation) {
        const demoPosition: Position = { ...origin, accuracy: 0, heading: null, speed: null }
        lastPosition.current = demoPosition
        setAccuracy(0)
        const dot = document.createElement('div'); dot.className = 'navigation-rider-marker'; dot.setAttribute('aria-label', 'Simulated rider start in Pune')
        riderMarker.current?.remove()
        riderMarker.current = new Marker({ element: dot, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([origin.longitude, origin.latitude]).addTo(map.current!)
        setMessage('Demo route starts at Swargate, Pune. Use “Next demo direction” to advance simulated turns.')
      } else {
        setMessage('Route calculated from your current GPS location. Keep Sarthi open for live guidance.')
      }
      if (initial) {
        navigationStartedRef.current(first, result.distance_m)
      }
    } catch (error) {
      if (requestId !== routeRequest.current) return
      const detail = error instanceof Error ? error.message : 'Route calculation failed. Please retry.'
      setNavigationState('error'); setMessage(detail); navigationErrorRef.current(detail)
    }
  }, [demoLocation, language, renderRoute])

  const startNavigation = useCallback(() => {
    if (!destinationReady || !destination.current) {
      const detail = 'The selected delivery address has not been located. Review the saved address and retry.'
      setMessage(detail); setNavigationState('error'); navigationErrorRef.current(detail); return
    }
    if (!demoLocation && !navigator.geolocation) {
      const detail = 'This browser does not support GPS location. In-app route guidance needs location access.'
      setMessage(detail); setNavigationState('error'); navigationErrorRef.current(detail); return
    }
    const requestId = ++routeRequest.current
    if (demoLocation) {
      setNavigationState('calculating'); setMessage('Starting demo navigation from Swargate, Pune…')
      void calculateRoute(DEMO_ORIGIN, true, requestId)
      return
    }
    setNavigationState('locating'); setMessage('Requesting your current GPS location…')
    navigator.geolocation.getCurrentPosition((position) => {
      if (requestId !== routeRequest.current) return
      const coords = position.coords
      const current: Position = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, heading: Number.isFinite(coords.heading) ? coords.heading : null, speed: Number.isFinite(coords.speed) ? coords.speed : null }
      lastPosition.current = current; setAccuracy(current.accuracy)
      if (current.accuracy > 100) { const detail = `GPS accuracy is too low (${Math.round(current.accuracy)} m). Move to a clearer area and retry.`; setMessage(detail); setNavigationState('error'); navigationErrorRef.current(detail); return }
      void calculateRoute(current, true, requestId)
    }, (error) => {
      if (requestId !== routeRequest.current) return
      const detail = error.code === error.PERMISSION_DENIED ? 'Location permission was denied. Enable location access in browser settings and retry.' : error.code === error.TIMEOUT ? 'GPS took too long to respond. Try again in a clearer area.' : 'Current GPS location is unavailable.'
      setMessage(detail); setNavigationState('error'); navigationErrorRef.current(detail)
    }, { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 })
  }, [calculateRoute, demoLocation, destinationReady])

  const startRef = useRef(startNavigation)
  startRef.current = startNavigation
  const autoStartedForStop = useRef<number | null>(null)
  useEffect(() => {
    if (autoStart && mapReady && destinationReady && autoStartedForStop.current !== stop.id) {
      autoStartedForStop.current = stop.id
      startRef.current()
    }
    if (!autoStart) autoStartedForStop.current = null
  }, [autoStart, mapReady, destinationReady, stop.id])

  const updatePosition = useCallback((position: GeolocationPosition) => {
    const coords = position.coords
    const current: Position = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, heading: Number.isFinite(coords.heading) ? coords.heading : null, speed: Number.isFinite(coords.speed) ? coords.speed : null }
    const previous = lastPosition.current
    lastPosition.current = current; setAccuracy(current.accuracy)
    const rider = riderMarker.current
    if (rider) rider.setLngLat([current.longitude, current.latitude])
    else {
      const dot = document.createElement('div'); dot.className = 'navigation-rider-marker'; dot.setAttribute('aria-label', 'Your current GPS location')
      riderMarker.current = new Marker({ element: dot, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([current.longitude, current.latitude]).addTo(map.current!)
    }
    if (navigationState === 'paused' || current.accuracy > 50) {
      if (current.accuracy > 50) setMessage(`GPS accuracy is weak (±${Math.round(current.accuracy)} m). Guidance will resume when it improves.`)
      return
    }
    let heading = current.speed !== null && current.speed >= 1.2 ? current.heading : null
    if ((heading === null || !Number.isFinite(heading)) && previous && previous.accuracy <= 50 && distanceBetween(previous, current) >= 8) heading = bearingBetween(previous, current)
    if (heading !== null && Number.isFinite(heading)) {
      if (smoothedHeading.current === null) smoothedHeading.current = heading
      else {
        const delta = ((heading - smoothedHeading.current + 540) % 360) - 180
        smoothedHeading.current = (smoothedHeading.current + delta * 0.22 + 360) % 360
      }
      riderMarker.current?.setRotation(smoothedHeading.current)
    } else smoothedHeading.current = null
    const instance = map.current
    if (follow && instance) instance.easeTo({ center: [current.longitude, current.latitude], zoom: 17, bearing: headingUp && smoothedHeading.current !== null ? smoothedHeading.current : 0, pitch: headingUp ? 45 : 0, duration: 650, essential: true })

    const data = route.current
    const target = destination.current
    if (!data || !target) return
    if (current.accuracy <= 35 && distanceBetween(current, target) <= 35) {
      route.current = null
      setNavigationState('arrived'); setInstruction('You have arrived at the delivery location.'); setMessage('You are near the destination. The delivery remains pending until OTP verification succeeds.')
      if (!completed) {
        setCompleted(true)
        const arrival = language.toLowerCase().startsWith('hi') ? /latn/i.test(language)
          ? 'Aap destination par pahunch gaye hain. Kya aap OTP se delivery complete karna chahenge?'
          : 'आप डिलीवरी पते पर पहुँच गए हैं। क्या आप OTP से डिलीवरी पूरी करना चाहेंगे?'
          : 'You have arrived at your delivery address. Would you like to complete this delivery using its OTP?'
        if (!muted) guidanceRef.current(arrival)
      }
      return
    }

    const steps = data.instructions
    let idx = Math.min(currentStep.current, steps.length - 1)
    let turnDistance = distanceBetween(current, { longitude: steps[idx].position[0], latitude: steps[idx].position[1] })
    if (turnDistance < 35 && idx < steps.length - 1) {
      idx += 1; currentStep.current = idx
      const text = localizeInstruction(steps[idx], language, turnDistance)
      setInstruction(text)
      if (!announced.current.has(idx) && !muted) { announced.current.add(idx); guidanceRef.current(text) }
      turnDistance = distanceBetween(current, { longitude: steps[idx].position[0], latitude: steps[idx].position[1] })
    }
    setDistanceToTurn(turnDistance)
    if (turnDistance <= 140 && !announced.current.has(idx) && !muted) {
      announced.current.add(idx)
      const text = localizeInstruction(steps[idx], language, turnDistance)
      setInstruction(text); guidanceRef.current(text)
    }
    let closest = Number.POSITIVE_INFINITY
    let progress = 0
    for (let i = 1; i < data.geometry.length; i++) {
      const [startLng, startLat] = data.geometry[i - 1]
      const [endLng, endLat] = data.geometry[i]
      const start = { latitude: startLat, longitude: startLng }, end = { latitude: endLat, longitude: endLng }
      const scaleX = 111320 * Math.cos(current.latitude * Math.PI / 180), scaleY = 110540
      const ax = (start.longitude - current.longitude) * scaleX, ay = (start.latitude - current.latitude) * scaleY
      const bx = (end.longitude - current.longitude) * scaleX, by = (end.latitude - current.latitude) * scaleY
      const dx = bx - ax, dy = by - ay
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / Math.max(1e-9, dx * dx + dy * dy)))
      const segmentDistance = Math.hypot(ax + t * dx, ay + t * dy)
      if (segmentDistance < closest) {
        closest = segmentDistance
        const segmentLength = routeProgress.current[i] - routeProgress.current[i - 1]
        progress = routeProgress.current[i - 1] + segmentLength * t
      }
    }
    const remainingRoute = Math.max(0, data.distance_m - progress)
    setMetersRemaining(remainingRoute)
    setDurationRemaining(data.duration_ms * remainingRoute / Math.max(1, data.distance_m))
    if (current.accuracy <= 30 && closest > 90) deviationCount.current += 1
    else deviationCount.current = 0
    if (deviationCount.current >= 3 && Date.now() - lastRecalculation.current > 20000) {
      deviationCount.current = 0; lastRecalculation.current = Date.now()
      setMessage('Route deviation detected. Recalculating using your latest reliable GPS location…')
      const requestId = ++routeRequest.current
      void calculateRoute(current, false, requestId)
    }
  }, [navigationState, follow, headingUp, completed, muted, language, calculateRoute])

  useEffect(() => {
    if (navigationState !== 'active' && navigationState !== 'paused') return
    if (demoLocation) return
    if (!navigator.geolocation) return
    watchId.current = navigator.geolocation.watchPosition(updatePosition, (error) => {
      setMessage(error.code === error.PERMISSION_DENIED ? 'GPS permission was revoked. Enable location access to continue guidance.' : 'GPS updates are temporarily unavailable. Check your location signal.')
    }, { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 })
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null }
  }, [demoLocation, navigationState, updatePosition])

  const endNavigation = useCallback(() => {
    routeRequest.current++
    if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null; route.current = null; routeProgress.current = []; currentStep.current = 0; announced.current.clear(); deviationCount.current = 0; setCompleted(false)
    if (map.current?.getLayer('sarthi-route-line')) map.current.removeLayer('sarthi-route-line')
    if (map.current?.getLayer('sarthi-route-casing')) map.current.removeLayer('sarthi-route-casing')
    if (map.current?.getSource('sarthi-route')) map.current.removeSource('sarthi-route')
    riderMarker.current?.remove(); riderMarker.current = null
    setMetersRemaining(null); setDurationRemaining(null); setDistanceToTurn(null); setInstruction('Navigation ended.'); setNavigationState('idle'); setMessage('Navigation ended.')
  }, [])

  useEffect(() => {
    if (stopIdentity.current === stop.id) return
    stopIdentity.current = stop.id
    endNavigation()
    destinationMarker.current?.remove()
    destinationMarker.current = null
    setDestinationReady(false)
  }, [stop.id, endNavigation])

  useEffect(() => { if (stopSignal > 0) endNavigation() }, [stopSignal, endNavigation])
  useEffect(() => {
    if (!command || command.requestId === handledCommand.current) return
    handledCommand.current = command.requestId
    if (command.action === 'pause' && navigationState === 'active') setNavigationState('paused')
    if (command.action === 'resume' && navigationState === 'paused') setNavigationState('active')
    if (command.action === 'repeat' && route.current) guidanceRef.current(instruction)
  }, [command, navigationState, instruction])

  const recenter = () => {
    setFollow(true)
    const current = lastPosition.current
    if (current && map.current) {
      map.current.easeTo({ center: [current.longitude, current.latitude], zoom: 17, bearing: headingUp && smoothedHeading.current !== null ? smoothedHeading.current : 0, pitch: headingUp ? 45 : 0, duration: 700 })
      return
    }
    if (!navigator.geolocation) { setMessage('This browser does not support current location.'); return }
    setMessage('Locating your current position…')
    navigator.geolocation.getCurrentPosition((position) => {
      const coords = position.coords
      const point: Position = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, heading: Number.isFinite(coords.heading) ? coords.heading : null, speed: Number.isFinite(coords.speed) ? coords.speed : null }
      if (point.accuracy > 100) { setMessage(`GPS accuracy is too low (±${Math.round(point.accuracy)} m). Try again in a clearer area.`); return }
      lastPosition.current = point; setAccuracy(point.accuracy)
      if (!riderMarker.current && map.current) {
        const dot = document.createElement('div'); dot.className = 'navigation-rider-marker'; dot.setAttribute('aria-label', 'Your current GPS location')
        riderMarker.current = new Marker({ element: dot, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([point.longitude, point.latitude]).addTo(map.current)
      } else riderMarker.current?.setLngLat([point.longitude, point.latitude])
      map.current?.easeTo({ center: [point.longitude, point.latitude], zoom: 16, bearing: 0, pitch: 0, duration: 700 })
      setHeadingUp(false); setMessage(`Current location shown (accuracy ±${Math.round(point.accuracy)} m).`)
    }, (error) => setMessage(error.code === error.PERMISSION_DENIED ? 'Location permission was denied. Allow it in browser settings to locate yourself.' : 'Current GPS location is unavailable. Try again outdoors.'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }
  const toggleHeading = () => {
    const next = !headingUp; setHeadingUp(next); setFollow(true)
    map.current?.easeTo({ bearing: next ? smoothedHeading.current ?? 0 : 0, pitch: next ? 45 : 0, duration: 500 })
  }
  const advanceDemoInstruction = () => {
    const instructions = route.current?.instructions
    if (!demoLocation || !instructions?.length) return
    const nextIndex = Math.min(demoInstructionIndex + 1, instructions.length - 1)
    setDemoInstructionIndex(nextIndex)
    const next = localizeInstruction(instructions[nextIndex], language)
    setInstruction(next)
    guidanceRef.current(next)
  }
  const durationText = durationRemaining === null ? '—' : `${Math.max(1, Math.round(durationRemaining / 60000))} min`
  const stateLabel = navigationState === 'active' ? 'ON ROUTE' : navigationState === 'paused' ? 'PAUSED' : navigationState === 'arrived' ? 'ARRIVED' : navigationState === 'locating' ? 'LOCATING' : navigationState === 'calculating' ? 'ROUTING' : navigationState === 'error' ? 'ERROR' : 'READY'

  return <section className="delivery-navigation" aria-label="In-app delivery navigation">
    <div className="navigation-map-head"><div><p className="eyebrow">IN-APP NAVIGATION{demoLocation ? ' · DEMO GPS: SWARGATE, PUNE' : ''}</p><strong>{stop.customer_name} · Order #{stop.order_number}</strong><span>{stop.address}</span></div><button className="map-control" aria-label="Recenter on rider" onClick={recenter}><LocateFixed size={19} /></button></div>
    <div className="navigation-map-wrap">
      <div className="navigation-map-canvas" ref={container} role="application" aria-label="Interactive OpenStreetMap route map" />
      {route.current && <div className="navigation-turn-card"><Navigation size={20}/><div><small>NEXT TURN{distanceToTurn !== null ? ` · ${formatDistance(distanceToTurn)}` : ''}</small><strong>{instruction}</strong></div></div>}
      <button className={`map-follow-control ${follow ? 'is-following' : ''}`} onClick={recenter} aria-label="Recenter and follow rider"><LocateFixed size={19}/></button>
    </div>
    <div className="navigation-summary">
      <div><small>ROUTE STATUS</small><strong>{stateLabel}</strong></div>
      <div><small>REMAINING</small><strong>{formatDistance(metersRemaining)}</strong></div>
      <div><small>EST. TIME</small><strong>{durationText}</strong></div>
    </div>
    <div className="navigation-destination"><MapPin size={17}/><div><strong>{stop.customer_name}</strong><span>{stop.access_note || stop.address}</span></div><button className="map-control map-north-control" onClick={toggleHeading} aria-label={headingUp ? 'Switch to north-up map' : 'Switch to heading-up map'}>{headingUp ? 'N↑' : 'N'}</button></div>
    {accuracy !== null && navigationState !== 'idle' && <p className="gps-accuracy">GPS accuracy ±{Math.round(accuracy)} m · {follow ? headingUp ? 'Following heading' : 'Following location' : 'Map exploration'}</p>}
    {message && <p className={navigationState === 'error' ? 'navigation-error' : 'navigation-message'} role="status">{message}</p>}
    {destinationError && <div className="navigation-retry-row"><button className="button button-light" onClick={() => setDestinationRetry(value => value + 1)}>Retry address lookup</button></div>}
    {!mapReady && message.includes('Map tiles could not load') && <div className="navigation-retry-row"><button className="button button-light" onClick={() => setMapRetry(value => value + 1)}>Retry map tiles</button></div>}
    <div className="navigation-controls">
      {navigationState !== 'active' && navigationState !== 'paused' && <button className="button button-light" onClick={() => { endNavigation(); setDemoLocation(value => !value) }}>{demoLocation ? 'Use live GPS' : 'Use Pune demo start'}</button>}
      {demoLocation && navigationState === 'active' && <button className="button button-light" onClick={advanceDemoInstruction}>Next demo direction</button>}
      {navigationState === 'active' ? <button className="button button-primary" onClick={() => setNavigationState('paused')}><Pause size={17}/> Pause</button> : navigationState === 'paused' ? <button className="button button-primary" onClick={() => setNavigationState('active')}><Play size={17}/> Resume</button> : <button className="button button-primary" onClick={startNavigation} disabled={!mapReady || !destinationReady || navigationState === 'locating' || navigationState === 'calculating'}><Navigation size={17}/>{navigationState === 'locating' ? 'Locating…' : navigationState === 'calculating' ? 'Calculating…' : navigationState === 'arrived' ? 'Start again' : !mapReady ? 'Loading map…' : !destinationReady ? 'Locating address…' : 'Start navigation'}</button>}
      <button className="button button-light" onClick={() => setMuted(value => !value)} disabled={navigationState !== 'active' && navigationState !== 'paused'} aria-label={muted ? 'Unmute voice guidance' : 'Mute voice guidance'}>{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>} {muted ? 'Muted' : 'Voice on'}</button>
      <button className="button button-light" onClick={recenter}><RotateCcw size={17}/> Recenter</button>
      {navigationState !== 'idle' && <button className="button button-light" onClick={endNavigation}><X size={17}/> End</button>}
    </div>
  </section>
}
