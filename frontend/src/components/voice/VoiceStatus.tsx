import type { ReactNode } from 'react'

export function VoiceStatus({ status, children }: { status: string; children: ReactNode }) {
  return <span className={`voice-status status-${status}`} role="status" aria-live="polite">{children}</span>
}

export function VoiceWaveform({ listening, speaking }: { listening: boolean; speaking: boolean }) {
  return <div className={`voice-wave ${listening ? 'wave-listening' : ''} ${speaking ? 'wave-speaking' : ''}`} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>
}
