import { useState } from 'react'
import { Phone, PhoneOff, UserRound } from 'lucide-react'
import type { Stop } from '../../api'

export function DemoCallScreen({ stop, onClose }: { stop: Stop; onClose: () => void }) {
  const [connected, setConnected] = useState(false)
  return <div className="demo-call-backdrop" role="presentation" onClick={onClose}>
    <section className="demo-call-screen" role="dialog" aria-modal="true" aria-labelledby="demo-call-title" onClick={(event) => event.stopPropagation()}>
      <span className="demo-call-label">DEMO CALL · SIMULATED</span>
      <span className="demo-call-avatar"><UserRound size={30} /></span>
      <h2 id="demo-call-title">{stop.customer_name}</h2>
      <p>{stop.customer_phone || 'No customer number is saved'}</p>
      <strong className="demo-call-status">{connected ? 'Simulated call connected' : 'Simulated incoming call'}</strong>
      <p className="demo-call-notice">This is a UI demonstration only. No telephone call is placed.</p>
      <div className="demo-call-actions">
        {!connected && <button className="button button-primary" onClick={() => setConnected(true)}><Phone size={17} /> Simulate answer</button>}
        <button className="button button-light" onClick={onClose}><PhoneOff size={17} /> {connected ? 'End demo call' : 'Dismiss'}</button>
      </div>
    </section>
  </div>
}
