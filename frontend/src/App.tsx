import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Mic, PackageCheck, Phone, ShieldCheck, Sparkles, Navigation, Home, List, Clock3, Volume2, Radio, LocateFixed } from 'lucide-react'
import { applyAction, ChatTurn, getActiveRun, Proposal, Run, saveCustomerPhone, speak, transcribe, understand } from './api'
import { beginRecording } from './recorder'

export default function App() {
  const [run, setRun] = useState<Run | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'processing'>('idle')
  const [transcript, setTranscript] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [understandingEngine, setUnderstandingEngine] = useState('Groq · decision model')
  const [responseLanguage, setResponseLanguage] = useState('hi-IN')
  const [page, setPage] = useState<'home' | 'deliveries' | 'map' | 'sarthi' | 'activity'>('home')
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [wakeEnabled, setWakeEnabled] = useState(false)
  const [wakeSupported, setWakeSupported] = useState(false)
  const [riderLocation, setRiderLocation] = useState<{ lat: number; lon: number } | null>(null)
  const wakeRecognition = useRef<{ start: () => void; stop: () => void; onresult: ((event: any) => void) | null; onend: (() => void) | null; onerror: (() => void) | null } | null>(null)
  const wakeTriggered = useRef(false)
  const recorder = useRef<Awaited<ReturnType<typeof beginRecording>> | null>(null)

  const refresh = async () => {
    try { setRun(await getActiveRun()); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the delivery run') }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    const supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
    setWakeSupported(supported)
  }, [])

  const stops = run?.stops ?? []
  const current = useMemo(() => stops.find((stop) => stop.status !== 'delivered'), [stops])
  const completed = stops.filter((stop) => stop.status === 'delivered').length

  const handleVoice = async () => {
    setError('')
    if (voiceState === 'processing') return
    if (voiceState === 'idle') {
      try {
        recorder.current = await beginRecording()
        setTranscript(''); setProposal(null); setVoiceState('recording')
      } catch { setError('Microphone access is needed. Check browser permissions and try again.') }
      return
    }
    setVoiceState('processing')
    try {
      const clip = await recorder.current?.stop()
      recorder.current = null
      if (!clip || clip.size < 1000) throw new Error('The recording was too short. Try speaking for a little longer.')
      const stt = await transcribe(clip)
      if (!stt.transcript.trim()) throw new Error('I could not hear speech in that recording. Please try again.')
      setTranscript(stt.transcript)
      const language = stt.detected_language_code ?? 'hi-IN'
      setResponseLanguage(language)
      const currentSummary = current ? JSON.stringify(current) : 'No active stop'
      const runContext = JSON.stringify({ rider: run?.rider_name, run_status: run?.status, stops: stops.map(({ order_number, customer_name, address, access_note, status, exception_reason, sequence }) => ({ order_number, customer_name, address, access_note, status, exception_reason, sequence })), completed, total: stops.length })
      const result = await understand(stt.transcript, stt.detected_language_code, currentSummary, runContext, history)
      if (result.intent === 'CALL_CUSTOMER' && !current?.customer_phone) result.response_text += ' Add the customer number in delivery details first.'
      if (result.intent === 'NAVIGATE_TO_STOP' && !current) result.proposed_action = null
      setProposal(result)
      setUnderstandingEngine(result.understanding_engine)
      setHistory((prior): ChatTurn[] => [...prior, { role: 'user' as const, content: stt.transcript }, { role: 'assistant' as const, content: result.response_text }].slice(-8))
      try { await speak(result.response_text, language) } catch { /* visible response remains available */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Voice request failed')
    } finally { setVoiceState('idle') }
  }

  const confirmProposal = async () => {
    if (!proposal?.proposed_action || !current) return
    setError('')
    if (proposal.proposed_action === 'call_customer') {
      if (!current.customer_phone) {
        const phone = window.prompt(`Enter the phone number for ${current.customer_name}`)
        if (!phone?.trim()) return
        try {
          const updated = await saveCustomerPhone(current.id, phone.trim())
          setRun(updated)
          setProposal({ ...proposal, response_text: 'Number saved. Tap “Call customer” again to open the dialer.' })
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the customer number') }
        return
      }
      window.location.href = `tel:${current.customer_phone}`
      setProposal(null)
      return
    }
    if (proposal.proposed_action === 'directions') {
      setPage('map')
      if (!riderLocation && navigator.geolocation) navigator.geolocation.getCurrentPosition((position) => setRiderLocation({ lat: position.coords.latitude, lon: position.coords.longitude }), () => undefined, { enableHighAccuracy: true, timeout: 8000 })
      setProposal(null)
      return
    }
    let otp: string | undefined
    if (proposal.proposed_action === 'delivered') {
      otp = window.prompt(`Enter the delivery OTP for order #${current.order_number}`) ?? undefined
      if (!otp) return
    }
    try {
      const updated = await applyAction(current.id, proposal.proposed_action, otp, transcript)
      setRun(updated); setProposal(null); setTranscript('')
      try { await speak('Your update has been saved.', responseLanguage === 'hi-IN' ? 'hi-IN' : responseLanguage) } catch { /* persistence does not depend on audio */ }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the delivery update') }
  }

  const recordManualAction = async (action: string) => {
    if (!current) return
    let otp: string | undefined
    if (action === 'delivered') {
      otp = window.prompt(`Enter the delivery OTP for order #${current.order_number}`) ?? undefined
      if (!otp) return
    }
    setError('')
    try { setRun(await applyAction(current.id, action, otp)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the update') }
  }

  const embeddedMap = current ? `https://maps.google.com/maps?output=embed&${riderLocation ? `saddr=${riderLocation.lat},${riderLocation.lon}&` : ''}daddr=${encodeURIComponent(current.address)}&z=14` : ''

  const toggleWake = () => {
    if (!wakeSupported) { setError('Wake phrase listening is supported in Chrome and some Android browsers. Use the Talk button here.'); return }
    if (wakeEnabled) { wakeRecognition.current?.stop(); wakeRecognition.current = null; setWakeEnabled(false); return }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new Recognition()
    recognition.lang = 'en-IN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event: any) => {
      const heard = Array.from(event.results as ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>)
        .map((item) => item[0].transcript).join(' ').toLowerCase()
      if (heard.includes('hey sarthi') || heard.includes('hey sarathi') || heard.includes('हे सारथी')) {
        wakeTriggered.current = true
        recognition.stop()
      }
    }
    recognition.onend = () => {
      if (wakeTriggered.current) { wakeTriggered.current = false; wakeRecognition.current = null; setWakeEnabled(false); window.setTimeout(() => void handleVoice(), 450); return }
      if (wakeRecognition.current === recognition && document.visibilityState === 'visible') { try { recognition.start() } catch { /* browser is restarting */ } }
    }
    recognition.onerror = () => { setWakeEnabled(false); wakeRecognition.current = null }
    wakeRecognition.current = recognition
    try { recognition.start(); setWakeEnabled(true); setError('') }
    catch { setError('Could not start wake listening. Allow microphone access and tap again.') }
  }

  useEffect(() => () => wakeRecognition.current?.stop(), [])

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark"><Sparkles size={18} /></span><span>Sarthi</span></a>
        <nav className="app-nav" aria-label="Rider pages">
          {([['home', Home, 'Home'], ['deliveries', List, 'Deliveries'], ['map', MapPin, 'Map'], ['sarthi', Mic, 'Sarthi'], ['activity', Clock3, 'Activity']] as const).map(([id, Icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={16} /><span>{label}</span></button>)}
        </nav>
        <div className="rider"><span className="online-dot" /> On shift <span className="avatar">A</span></div>
      </header>
      <section className="welcome-row">
        <div><p className="eyebrow">TODAY'S RUN · SAMPLE DATA</p><h1>Good morning, {run?.rider_name ?? 'Rider'} <span>👋</span></h1><p className="muted">Your delivery run and rider assistance in one place.</p></div>
        <div className="run-pill"><span className="online-dot" /> {run?.status === 'active' ? 'Active run' : loading ? 'Loading…' : 'Run unavailable'}</div>
      </section>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {page === 'home' && <section className="stats-grid" aria-label="Run progress">
        <article className="stat-card"><span className="stat-icon purple"><PackageCheck size={18} /></span><div><strong>{completed}/{stops.length}</strong><span>Delivered</span></div></article>
        <article className="stat-card"><span className="stat-icon mint"><MapPin size={18} /></span><div><strong>{stops.length - completed}</strong><span>Stops remaining</span></div></article>
        <article className="stat-card"><span className="stat-icon peach"><ShieldCheck size={18} /></span><div><strong>{run?.status === 'active' ? 'On route' : '—'}</strong><span>Run status</span></div></article>
      </section>}
      <section className="content-grid">
        <div className="main-column">
          {(page === 'home' || page === 'deliveries') && <article className="current-card">
            <div className="section-heading"><div><p className="eyebrow">CURRENT DELIVERY</p><h2>{current ? `Order #${current.order_number}` : loading ? 'Loading delivery…' : 'All deliveries complete'}</h2></div>{current && <span className="status-tag">Next stop</span>}</div>
            {current && <>
              <div className="customer-row"><div className="customer-avatar">{current.customer_name[0]}</div><div className="customer-info"><strong>{current.customer_name}</strong><span>Delivery verification required</span></div>{current.customer_phone ? <a className="icon-button" aria-label="Call customer" href={`tel:${current.customer_phone}`}><Phone size={17} /></a> : <button className="icon-button" aria-label="Add customer phone number" title="Add a number to enable calling" onClick={() => { const phone = window.prompt(`Enter the phone number for ${current.customer_name}`); if (phone?.trim()) void saveCustomerPhone(current.id, phone.trim()).then(setRun).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save the customer number')) }}><Phone size={17} /></button>}</div>
              <div className="address-box"><MapPin size={19} /><div><strong>{current.address}</strong><span>{current.access_note || 'No access notes'}</span></div></div>
              <div className="action-row"><button className="button button-primary" onClick={() => { setPage('map'); if (!riderLocation) navigator.geolocation?.getCurrentPosition((p) => setRiderLocation({ lat: p.coords.latitude, lon: p.coords.longitude }), () => undefined) }}><Navigation size={17} /> Open in-app map</button><button className="button button-light" onClick={() => void handleVoice()} disabled={voiceState === 'processing'}><Mic size={17} /> {voiceState === 'recording' ? 'Tap to finish' : voiceState === 'processing' ? 'Working…' : 'Talk to Sarthi'}</button></div>
              <div className="manual-actions"><span>Or update manually</span><button onClick={() => void recordManualAction('contact_attempt')}>Customer unreachable</button><button onClick={() => void recordManualAction('wrong_address')}>Address problem</button><button onClick={() => void recordManualAction('delivered')}>Verify delivery</button></div>
            </>}
          </article>}
          {(page === 'home' || page === 'sarthi') && (transcript || proposal) && <article className="list-card"><p className="eyebrow">VOICE UPDATE</p>{transcript && <p className="transcript">“{transcript}”</p>}{proposal && <><p className="proposal-text">{proposal.response_text}</p>{proposal.proposed_action ? <div className="action-row"><button className="button button-primary" onClick={() => void confirmProposal()}>{proposal.proposed_action === 'contact_attempt' ? 'Record contact attempt' : proposal.proposed_action === 'wrong_address' ? 'Record address issue' : proposal.proposed_action === 'reschedule' ? 'Record time request' : proposal.proposed_action === 'delivered' ? 'Verify with OTP' : proposal.proposed_action === 'call_customer' ? 'Call customer' : 'Open in-app map'}</button><button className="button button-light" onClick={() => { setProposal(null); setTranscript('') }}>Cancel</button></div> : <button className="button button-light" onClick={() => { setProposal(null); setTranscript('') }}>Close</button>}</>}</article>}
          {(page === 'home' || page === 'deliveries') && <article className="list-card"><div className="section-heading"><div><p className="eyebrow">YOUR RUN</p><h2>{page === 'deliveries' ? 'Delivery details & stops' : 'Delivery stops'}</h2></div><span className="count-label">{stops.length} stops</span></div>
            <div className="stop-list">{stops.map((stop, index) => <div className={`stop-row ${stop.status === 'delivered' ? 'done' : stop.id === current?.id ? 'current' : 'upcoming'}`} key={stop.id}><div className="stop-marker">{stop.status === 'delivered' ? '✓' : index + 1}</div><div className="stop-copy"><strong>{stop.customer_name} <span>#{stop.order_number}</span></strong><p>{stop.address}</p>{stop.exception_reason && <small>Issue: {stop.exception_reason.replace(/_/g, ' ')}</small>}{stop.id === current?.id && <small>{stop.access_note} · Verification required</small>}</div><span className={`stop-state ${stop.status === 'delivered' ? 'done' : stop.id === current?.id ? 'current' : ''}`}>{stop.status === 'delivered' ? 'Delivered' : stop.status === 'exception' ? 'Needs follow-up' : stop.id === current?.id ? 'Current' : 'Upcoming'}</span></div>)}</div>
          </article>}
          {page === 'map' && <article className="list-card map-page"><div className="section-heading"><div><p className="eyebrow">LIVE DESTINATION</p><h2>{current ? `Order #${current.order_number}` : 'No active stop'}</h2></div><button className="button button-light" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setRiderLocation({ lat: p.coords.latitude, lon: p.coords.longitude }), () => setError('Location permission is needed to show your starting point.'))}><LocateFixed size={16} /> Locate me</button></div>{current ? <><p className="map-address"><MapPin size={16} />{current.address}</p><div className="map-frame"><iframe title="In-app directions map" src={embeddedMap} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div><p className="map-help">The route is shown here inside Sarthi. Ask “repeat the address” or “read the access note” by voice. For safe, detailed turn-by-turn driving directions, use a mounted phone and keep your attention on the road.</p><button className="button button-primary" onClick={() => { void speak(`${current.address}. ${current.access_note}`, responseLanguage).catch(() => setError('Could not play voice guidance')) }}><Volume2 size={16} /> Speak destination & access note</button></> : <p className="muted">All stops are complete.</p>}</article>}
          {page === 'sarthi' && <article className="list-card sarthi-page"><div className="section-heading"><div><p className="eyebrow">VOICE CO-PILOT</p><h2>Talk naturally to Sarthi</h2></div><span className="count-label">{understandingEngine}</span></div><p className="muted">Ask any question about your run, explain a delivery issue, request an update, or ask general questions. Sarthi responds in the language it hears.</p><button className={`button ${wakeEnabled ? 'button-primary' : 'button-light'} wake-button`} onClick={toggleWake}><Radio size={17} />{wakeEnabled ? 'Listening for “Hey Sarthi” · tap to turn off' : 'Enable “Hey Sarthi” hands-free'}</button><p className="wake-note">{wakeSupported ? 'Wake listening works only while this page stays open and in the foreground; browser support and language recognition vary. The microphone indicator stays visible.' : 'This browser does not support wake phrase listening. Tap the microphone to speak.'} Please use voice controls only when it is safe to do so.</p><button className="voice-button speak-large" onClick={() => void handleVoice()} disabled={voiceState === 'processing'}><Mic size={20} /><span>{voiceState === 'recording' ? 'Tap to finish speaking' : voiceState === 'processing' ? 'Sarthi is thinking…' : 'Tap to speak'}</span></button><div className="conversation-list">{history.map((turn, index) => <p className={turn.role === 'user' ? 'user-turn' : 'assistant-turn'} key={`${index}-${turn.role}`}>{turn.content}</p>)}</div></article>}
          {page === 'activity' && <article className="timeline-card"><div className="section-heading"><div><p className="eyebrow">TODAY</p><h2>Run timeline</h2></div></div>{run?.activities.length ? [...run.activities].reverse().map((activity, index) => <div className="timeline-item" key={activity.id}><span className={`timeline-dot ${index === 0 ? 'active' : ''}`} /><div><strong>{activity.summary}</strong><p>{new Date(activity.created_at).toLocaleString()}</p>{activity.transcript && <p>“{activity.transcript}”</p>}</div></div>) : <p className="muted">Updates will appear here.</p>}</article>}
        </div>
        <aside className="side-column">
          {(page === 'home' || page === 'sarthi') && <article className={`assistant-card ${voiceState === 'recording' ? 'is-listening' : ''}`}><div className="assistant-top"><div className="assistant-orb"><Sparkles size={21} /></div><div><strong>Sarthi</strong><span>Your delivery co-pilot</span></div><span className="online-dot" /></div><p>{voiceState === 'recording' ? 'I’m listening. Tap again when you’ve finished speaking.' : voiceState === 'processing' ? 'Checking what you said…' : 'Ask a question or tell me what you need. I’ll use your live run details and confirm before taking action.'}</p><button className="voice-button" onClick={() => void handleVoice()} disabled={voiceState === 'processing'}><Mic size={21} /><span>{voiceState === 'recording' ? 'Tap to finish' : voiceState === 'processing' ? 'Working…' : 'Tap to speak'}</span></button><small>Prisma · {understandingEngine} · Timbre</small></article>}
          {page === 'home' && <article className="timeline-card"><div className="section-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Recent updates</h2></div><button className="text-button" onClick={() => setPage('activity')}>See all</button></div>{run?.activities.length ? [...run.activities].reverse().slice(0, 4).map((activity, index) => <div className="timeline-item" key={activity.id}><span className={`timeline-dot ${index === 0 ? 'active' : ''}`} /><div><strong>{activity.summary}</strong><p>{new Date(activity.created_at).toLocaleString()}</p></div></div>) : <p className="muted">Updates will appear here.</p>}</article>}
          {page === 'deliveries' && current && <article className="timeline-card"><p className="eyebrow">STOP ACTIONS</p><h2>Update delivery</h2><button className="button button-light wide" onClick={() => void recordManualAction('contact_attempt')}>Record contact attempt</button><button className="button button-light wide" onClick={() => void recordManualAction('wrong_address')}>Report address issue</button><button className="button button-light wide" onClick={() => void recordManualAction('reschedule')}>Record time request</button><button className="button button-primary wide" onClick={() => void recordManualAction('delivered')}>Mark delivered · verify OTP</button></article>}
          {page === 'map' && current && <article className="assistant-card"><div className="assistant-top"><div className="assistant-orb"><Navigation size={19} /></div><div><strong>Hands-free help</strong><span>Talk while the map stays open</span></div></div><p>Ask Sarthi to repeat this address, read saved entry notes, or tell you how many stops remain.</p><button className="voice-button" onClick={() => void handleVoice()} disabled={voiceState === 'processing'}><Mic size={18} /><span>{voiceState === 'recording' ? 'Tap to finish' : 'Talk to Sarthi'}</span></button></article>}
        </aside>
      </section>
      <footer>Made for riders, by Sarthi <span>·</span> Voice-first delivery support · Do not interact while driving</footer>
    </main>
  )
}
