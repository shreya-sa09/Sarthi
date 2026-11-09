const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type GeoPoint = { latitude: number; longitude: number }
export type NavigationRoute = {
  geometry: [number, number][]
  distance_m: number
  duration_ms: number
  language: string
  instructions: { text: string; distance_m: number; duration_ms: number; sign: number; street_name: string; position: [number, number] }[]
}

export type Stop = {
  id: number
  sequence: number
  order_number: string
  customer_name: string
  customer_phone: string
  address: string
  access_note: string
  parcel_description: string
  package_category: string
  weight_kg: number | null
  payment_type: string
  cod_amount: number | null
  delivery_window: string | null
  status: string
  exception_reason: string | null
  otp_length: number
}

export type Activity = {
  id: number
  stop_id: number | null
  event_type: string
  summary: string
  transcript: string | null
  created_at: string
}

export type Run = {
  id: number
  rider_name: string
  status: string
  is_demo: boolean
  started_at: string
  stops: Stop[]
  activities: Activity[]
}

export type Proposal = {
  intent: string
  confidence: number
  extracted_details: Record<string, string>
  response_text: string
  proposed_action: 'contact_attempt' | 'wrong_address' | 'reschedule' | 'delivered' | 'call_customer' | 'directions' | null
  requires_confirmation: boolean
  understanding_engine: string
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init)
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try { detail = (await response.json()).detail ?? detail } catch { /* keep status message */ }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export const getActiveRun = () => request<Run>('/api/run/active')

export const geocodeDeliveryAddress = (address: string) => request<GeoPoint & { label: string }>(`/api/navigation/geocode?q=${encodeURIComponent(address)}`)

export const getNavigationRoute = (origin: GeoPoint, destination: GeoPoint, language = 'en') => request<NavigationRoute>('/api/navigation/route', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ origin, destination, language }),
})

export const saveCustomerPhone = (stopId: number, phone: string) =>
  request<Run>(`/api/stops/${stopId}/contact`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })

export const applyAction = (stopId: number, action: string, otp?: string, transcript?: string) =>
  request<Run>(`/api/stops/${stopId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, otp, transcript }),
  })

export async function transcribe(audio: Blob): Promise<{ transcript: string; detected_language_code?: string }> {
  const form = new FormData()
  form.append('audio_file', audio, 'rider-utterance.wav')
  return request('/api/voice/transcribe', { method: 'POST', body: form })
}

export const understand = (transcript: string, language?: string, selectedStopId?: number | null, conversationHistory?: ChatTurn[]) =>
  request<Proposal>('/api/voice/understand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, language, selected_stop_id: selectedStopId, conversation_history: conversationHistory }),
  })

let activeSpeech: { audio: HTMLAudioElement | null; controller: AbortController; stop: (() => void) | null } | null = null
let playbackUnlocked = false

function silentWav(): Blob {
  const sampleCount = 800
  const bytes = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(bytes)
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)) }
  write(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data')
  view.setUint32(40, sampleCount * 2, true)
  return new Blob([bytes], { type: 'audio/wav' })
}

export async function unlockSpeechPlayback(): Promise<void> {
  if (playbackUnlocked) return
  const url = URL.createObjectURL(silentWav())
  const audio = new Audio(url)
  audio.volume = 0.01
  try {
    await audio.play()
    playbackUnlocked = true
  } finally {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    URL.revokeObjectURL(url)
  }
}

function validateWav(bytes: ArrayBuffer) {
  if (bytes.byteLength < 44) throw new Error('Speech service returned an empty or truncated WAV file.')
  const view = new DataView(bytes)
  const ascii = (offset: number) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') throw new Error('Speech service returned audio in an unsupported format.')
  if (view.getUint32(4, true) !== bytes.byteLength - 8) throw new Error('Speech service returned a malformed WAV header.')
  let offset = 12
  let hasFormat = false
  let hasAudio = false
  while (offset + 8 <= bytes.byteLength) {
    const kind = ascii(offset)
    const size = view.getUint32(offset + 4, true)
    if (offset + 8 + size > bytes.byteLength) throw new Error('Speech service returned a truncated WAV file.')
    if (kind === 'fmt ' && size >= 16) hasFormat = true
    if (kind === 'data' && size > 0) hasAudio = true
    offset += 8 + size + (size & 1)
  }
  if (!hasFormat || !hasAudio) throw new Error('Speech service returned a WAV file without playable audio.')
}

export function stopSpeaking() {
  const current = activeSpeech
  if (!current) return
  activeSpeech = null
  current.controller.abort()
  current.audio?.pause()
  current.audio?.removeAttribute('src')
  current.audio?.load()
  current.stop?.()
}

export async function speak(text: string, language = 'hi-IN') {
  stopSpeaking()
  const controller = new AbortController()
  const speech = { audio: null as HTMLAudioElement | null, controller, stop: null as (() => void) | null }
  activeSpeech = speech
  let response: Response
  try {
    response = await fetch(`${API}/api/voice/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language }),
      signal: controller.signal,
    })
  } catch (error) {
    if (activeSpeech === speech) activeSpeech = null
    throw error
  }
  if (!response.ok) {
    if (activeSpeech === speech) activeSpeech = null
    throw new Error('Speech response could not be generated')
  }
  let responseBlob: Blob
  try { responseBlob = await response.blob() }
  catch (error) { if (activeSpeech === speech) activeSpeech = null; throw error }
  const contentType = (response.headers.get('content-type') || responseBlob.type).split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'audio/wav' && contentType !== 'audio/x-wav') {
    if (activeSpeech === speech) activeSpeech = null
    throw new Error(`Speech service returned an unsupported format (${contentType || 'unknown'}).`)
  }
  let audioBytes: ArrayBuffer
  try { audioBytes = await responseBlob.arrayBuffer(); validateWav(audioBytes) }
  catch (error) { if (activeSpeech === speech) activeSpeech = null; throw error }
  let audioUrl: string
  try { audioUrl = URL.createObjectURL(new Blob([audioBytes], { type: 'audio/wav' })) }
  catch (error) { if (activeSpeech === speech) activeSpeech = null; throw error }
  const audio = new Audio()
  audio.preload = 'auto'
  audio.src = audioUrl
  speech.audio = audio
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (activeSpeech === speech) activeSpeech = null
      if (speech.stop === finish) speech.stop = null
      cleanup()
      if (error) reject(error); else resolve()
    }
    const cleanup = () => {
      audio.onended = null
      audio.onerror = null
      URL.revokeObjectURL(audioUrl)
    }
    speech.stop = () => finish(new DOMException('Speech playback stopped', 'AbortError'))
    audio.onended = () => finish()
    audio.onerror = () => finish(new Error(audio.error?.code === MediaError.MEDIA_ERR_DECODE
      ? 'Your browser could not decode the Timbre WAV response.'
      : audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'Your browser does not support the returned Timbre audio format.'
        : 'Timbre audio could not be loaded by the browser.'))
    audio.play().catch((error: unknown) => finish(error instanceof Error ? error : new Error('Speech audio could not be played')))
  })
}
