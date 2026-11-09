import { Mic, Sparkles, Volume2 } from 'lucide-react'

export function AssistantShortcut({ status, label, busy, micLabel, lastResponse, disabled, onOpen, onRepeat, onRetry }: {
  status: string
  label: string
  busy: boolean
  micLabel: string
  lastResponse: string
  disabled: boolean
  onOpen: () => void
  onRepeat: () => void
  onRetry: () => void
}) {
  return <article className={`assistant-card ${status === 'listening' ? 'is-listening' : ''}`}><div className="assistant-top"><div className="assistant-orb"><Sparkles size={20} /></div><div><strong>Sarthi</strong><span>Your delivery co-pilot</span></div></div><p>{status === 'listening' ? 'I’m listening. Tap again when you’ve finished.' : busy ? label : 'Ask about your run or tell me what you need. I’ll confirm before taking action.'}</p><span className={`voice-status status-${status}`} role="status" aria-live="polite">{label}</span><button className="voice-button" onClick={onOpen} disabled={disabled}><Mic size={20} /><span>{micLabel}</span></button>{lastResponse && status !== 'error' && <button className="repeat-response" onClick={onRepeat} disabled={busy}><Volume2 size={15} /> Repeat response</button>}{status === 'error' && <button className="button button-light voice-retry-button" onClick={onRetry}>Try again</button>}<small>Prisma · decision provider · Timbre</small></article>
}
