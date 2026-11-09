import { Mic, Radio, Volume2 } from 'lucide-react'
import type { ChatTurn } from '../api'
import { VoiceStatus, VoiceWaveform } from '../components/voice/VoiceStatus'

export function SarthiPage({ status, statusLabel, engine, wakeEnabled, sessionActive, wakeSupported, canStartVoice, voiceBusy, micLabel, lastResponse, history, onMic, onToggleWake, onRetry, onRepeat }: {
  status: string
  statusLabel: string
  engine: string
  wakeEnabled: boolean
  sessionActive: boolean
  wakeSupported: boolean
  canStartVoice: boolean
  voiceBusy: boolean
  micLabel: string
  lastResponse: string
  history: ChatTurn[]
  onMic: () => void
  onToggleWake: () => void
  onRetry: () => void
  onRepeat: () => void
}) {
  return <article className="list-card sarthi-page"><div className="section-heading"><div><p className="eyebrow">VOICE CO-PILOT</p><h2>Talk naturally to Sarthi</h2></div><span className="count-label">{engine}</span></div><p className="muted">Ask about your run, explain a delivery issue, or request an update. Sarthi responds in the language it hears.</p>
    <div className={`voice-stage ${status === 'listening' ? 'is-listening' : ''} ${status === 'speaking' ? 'is-speaking' : ''}`}>
      <VoiceWaveform listening={status === 'listening'} speaking={status === 'speaking'} />
      <button className="voice-main-button" onClick={onMic} disabled={!canStartVoice && status !== 'listening'} aria-label={micLabel}><Mic size={29} /></button>
      <VoiceStatus status={status}>{statusLabel}</VoiceStatus>
      <p>{status === 'listening' ? 'Speak naturally. The recording sends when you pause; tap the microphone to finish.' : status === 'standby' ? 'Say “Hello Sarthi” while this page is open and in the foreground.' : status === 'awaiting_confirmation' ? 'Review the proposed action and confirm or cancel.' : status === 'error' ? 'Your transcript and manual controls remain available.' : 'Tap the microphone to speak.'}</p>
      {status === 'error' && <button className="button button-light voice-stage-retry" onClick={onRetry}>Try again</button>}
    </div>
    <button className={`button ${wakeEnabled || sessionActive ? 'button-primary' : 'button-light'} wake-button`} onClick={onToggleWake}><Radio size={17} />{sessionActive ? 'Stop voice session' : wakeEnabled ? 'Pause Hello Sarthi standby' : 'Start Hello Sarthi standby'}</button>
    <p className="wake-note">{wakeSupported ? 'Foreground wake listening needs this browser tab open. Prisma transcribes commands. Browser support varies.' : 'Wake phrase listening is unavailable here; use the microphone button.'} Use voice controls only when safe.</p>
    {lastResponse && <button className="repeat-response" onClick={onRepeat} disabled={voiceBusy}><Volume2 size={15} /> Repeat response</button>}
    <div className="conversation-list" aria-label="Conversation history">{history.map((turn, index) => <p className={turn.role === 'user' ? 'user-turn' : 'assistant-turn'} key={`${index}-${turn.role}`}>{turn.content}</p>)}</div>
  </article>
}
