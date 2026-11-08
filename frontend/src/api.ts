const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type Stop = {
  id: number
  sequence: number
  order_number: string
  customer_name: string
  customer_phone: string
  address: string
  access_note: string
  status: string
  exception_reason: string | null
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

export const understand = (transcript: string, language?: string, currentStop?: string, runContext?: string, conversationHistory?: ChatTurn[]) =>
  request<Proposal>('/api/voice/understand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, language, current_stop_summary: currentStop, run_context: runContext, conversation_history: conversationHistory }),
  })

export async function speak(text: string, language = 'hi-IN') {
  const response = await fetch(`${API}/api/voice/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  })
  if (!response.ok) throw new Error('Speech response could not be generated')
  const audio = new Audio(URL.createObjectURL(await response.blob()))
  await audio.play()
}
