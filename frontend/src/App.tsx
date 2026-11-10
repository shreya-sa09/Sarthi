import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Mic, Volume2, ArrowLeft, ShieldCheck } from 'lucide-react'
import { applyAction, ChatTurn, getActiveRun, Proposal, Run, Stop, saveCustomerPhone, speak as speakTimbre, stopSpeaking, transcribe, understand, unlockSpeechPlayback } from './api'
import { beginRecording } from './recorder'
import { AppHeader } from './components/layout/AppHeader'
import { BottomNavigation, type AppPage } from './components/layout/BottomNavigation'
import { DeliveryProgress } from './components/delivery/DeliveryProgress'
import { ActiveDeliveryCard } from './components/delivery/ActiveDeliveryCard'
import { NextDeliveryCard } from './components/delivery/NextDeliveryCard'
import { ActivityTimeline } from './components/activity/ActivityTimeline'
import { MapPage } from './pages/MapPage'
import { DeliveriesPage, type DeliveryFilter } from './pages/DeliveriesPage'
import { ActivityPage } from './pages/ActivityPage'
import { SarthiPage } from './pages/SarthiPage'
import { AssistantShortcut } from './components/voice/AssistantShortcut'
import { WelcomePage } from './pages/WelcomePage'
import type { NavigationSnapshot } from './components/map/DeliveryNavigationMap'

type VoiceStatus = 'idle' | 'standby' | 'wake_detected' | 'listening' | 'processing' | 'understanding' | 'awaiting_confirmation' | 'speaking' | 'success' | 'error'
const OTP_DIGIT_WORDS: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', शून्य: '0', एक: '1', दो: '2', तीन: '3', चार: '4', पाँच: '5', पांच: '5', छह: '6', सात: '7', आठ: '8', नौ: '9' }

function speechLanguage(detected: string | undefined, transcript: string): string {
  const normalized = (detected ?? '').trim().toLowerCase()
  if (/\b(kya|kaun|kiska|kitne|baaki|hai|hain|karna|karo|mujhe|mera|meri|uska|uski|pata|batao|bataiye|kahan|kahaan|jana|jaana|jao|dikhao|dikhaiye|kholo|chalo|paas|nahi|nahin|raha|rahi|wala|wali|par|pe|se|ko|ke|ka|ki|agla|agli|ghar|chahiye|kar diya|kar di|raha hoon|rahi hoon|haan|han|bilkul|theek|sahi|ji)\b/i.test(transcript)) return 'hi-Latn'
  if (/[\u0900-\u097f]/.test(transcript) || normalized.startsWith('hi')) return 'hi-IN'
  if (normalized.startsWith('en')) return 'en-IN'
  if (normalized.includes('-')) return normalized
  return 'en-IN'
}

function localizedReply(english: string, hindi: string, language: string, hinglish = english): string {
  if (language.toLowerCase() === 'hi-latn') return hinglish
  return language.toLowerCase().startsWith('hi') ? hindi : english
}

function isStopPhrase(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim()
  return /^(?:stop(?: sarthi| talking| listening)?|cancel|goodbye sarthi|goodbye sarathi|bas karo(?: sarthi)?|ruko(?: sarthi| zara)?|ruk jao(?: sarthi)?|रुको|रुकिए|रुक जाओ|बंद करो|सुनना बंद करो|रद्द करो)$/.test(normalized)
}

function isStopNavigationPhrase(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim()
  return /^(?:stop|cancel)(?: the)? navigation$|^(?:navigation|directions) (?:band|rok|roko|khatam|cancel)(?: karo)?$|^(?:नेविगेशन|दिशा)(?: बंद| रोक| रद्द)(?: करो| कीजिए)?$/.test(normalized)
}

function isCurrentDeliveryPhrase(text: string): boolean {
  return /\b(?:current|this|present|right now)\s+(?:delivery|order|stop)\b|\b(?:is|iss)\s+(?:order|delivery|stop)\b|अभी\s+(?:जो\s+)?(?:ऑर्डर|order|डिलीवरी|delivery)\s+(?:है|चल\s+रहा\s+है)|इसी\s+(?:ऑर्डर|order|डिलीवरी|delivery)|यही\s+(?:ऑर्डर|order|डिलीवरी|delivery)/i.test(text)
}

function isAffirmative(text: string): boolean {
  return /^(?:yes|yeah|yep|sure|confirm|haan|हाँ|जी|हाँ करिए|करो|ठीक|ठीक है|haan ji|हाँ,? कर दीजिए|सही है)(?:\s+(?:that's right|that is right|correct|go ahead|कर दीजिए|सही है))?[.! ]*$/i.test(text.trim())
}

function normalizeOtpSpeech(text: string): string {
  const otpMarker = /\b(?:otp|code|pin)\b|ओटीपी|कोड/i.exec(text)
  const spokenPart = otpMarker ? text.slice(otpMarker.index + otpMarker[0].length).replace(/\b(?:for|order|number|ऑर्डर)\b.*$/i, '') : text
  const normalizedDigits = spokenPart.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966))
  const numericDigits = normalizedDigits.replace(/\D/g, '')
  if (numericDigits) return numericDigits
  const words = normalizedDigits.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
  const digits: string[] = []
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    if (word === 'double' || word === 'triple' || word === 'दोहरा' || word === 'तिगुना') {
      const next = OTP_DIGIT_WORDS[words[index + 1]]
      if (next) { digits.push(next, ...(word === 'triple' || word === 'तिगुना' ? [next] : [])); index++ }
      continue
    }
    const digit = OTP_DIGIT_WORDS[word]
    if (digit) digits.push(digit)
  }
  return digits.join('')
}

export default function App() {
  const [run, setRun] = useState<Run | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [transcript, setTranscript] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [lastResponse, setLastResponse] = useState('')
  const [actionFailed, setActionFailed] = useState(false)
  const [understandingEngine, setUnderstandingEngine] = useState('Groq · decision model')
  const [responseLanguage, setResponseLanguage] = useState('en-IN')
  const [page, setPage] = useState<AppPage>('home')
  const [welcomeComplete, setWelcomeComplete] = useState(() => window.localStorage.getItem('sarthi:onboarding-complete') === 'true')
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [wakeEnabled, setWakeEnabled] = useState(false)
  const [wakeSupported, setWakeSupported] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [audioNeedsUnlock, setAudioNeedsUnlock] = useState(false)
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>('all')
  const [navigationStartStopId, setNavigationStartStopId] = useState<number | null>(null)
  const [navigationStopVersion, setNavigationStopVersion] = useState(0)
  const [navigationCommand, setNavigationCommand] = useState<{ action: 'pause' | 'resume'; requestId: number } | null>(null)
  const [navigationSnapshot, setNavigationSnapshot] = useState<NavigationSnapshot>({ state: 'idle', instruction: '', metersRemaining: null })
  const [navigationCommandId, setNavigationCommandId] = useState(0)
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null)
  const [otpEntry, setOtpEntry] = useState('')
  const [otpPending, setOtpPending] = useState(false)
  const [otpStopId, setOtpStopId] = useState<number | null>(null)
  const [otpConfirmed, setOtpConfirmed] = useState(false)
  const [phoneEntry, setPhoneEntry] = useState('')
  const [phoneEditorOpen, setPhoneEditorOpen] = useState(false)
  const wakeRecognition = useRef<any>(null)
  const wakeSupportedRef = useRef(false)
  const wakeTriggered = useRef(false)
  const conversationActive = useRef(false)
  const sessionGeneration = useRef(0)
  const recordingProcessing = useRef(false)
  const navigationInFlight = useRef(false)
  const actionInFlight = useRef(false)
  const navigationOfferStopId = useRef<number | null>(null)
  const navigationRequestGeneration = useRef(0)
  const navigationStartPending = useRef(false)
  const recognitionMode = useRef<'standby' | 'interrupt' | null>(null)
  const recognitionRestartTimer = useRef<number | null>(null)
  const recorder = useRef<Awaited<ReturnType<typeof beginRecording>> | null>(null)
  const finishRecordingRef = useRef<() => Promise<void>>(async () => undefined)
  const receiveNavigationSnapshot = useCallback((snapshot: NavigationSnapshot) => {
    navigationStartPending.current = snapshot.state === 'locating' || snapshot.state === 'calculating'
    setNavigationSnapshot(snapshot)
  }, [])
  wakeSupportedRef.current = wakeSupported

  const refresh = async () => {
    try { setRun(await getActiveRun()); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the delivery run') }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    const supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
    setWakeSupported(supported)
    if (supported && !welcomeComplete && document.visibilityState === 'visible') return
    if (supported && document.visibilityState === 'visible') window.setTimeout(() => startStandbyRecognition(), 250)
  }, [welcomeComplete])

  const stops = run?.stops ?? []
  const orderedStops = useMemo(() => [...stops].sort((left, right) => left.sequence - right.sequence || left.id - right.id), [stops])
  const activeStop = useMemo(() => orderedStops.find((stop) => stop.status === 'pending'), [orderedStops])
  const selectedStop = useMemo(() => stops.find((stop) => stop.id === selectedStopId) ?? null, [stops, selectedStopId])
  const otpStop = useMemo(() => stops.find((stop) => stop.id === otpStopId) ?? null, [stops, otpStopId])
  const current = useMemo(() => otpPending && otpStop ? otpStop : stops.find((stop) => stop.id === selectedStopId && stop.status !== 'delivered') ?? activeStop ?? null, [stops, selectedStopId, activeStop, otpPending, otpStop])
  const mapTarget = otpPending && otpStop ? otpStop : selectedStop ?? current
  const nextStop = useMemo(() => orderedStops.find((stop) => stop.status === 'pending' && stop.id !== activeStop?.id), [orderedStops, activeStop])
  const completed = stops.filter((stop) => stop.status === 'delivered').length
  const remaining = stops.filter((stop) => stop.status !== 'delivered').length
  const voiceBusy = ['wake_detected', 'processing', 'understanding', 'speaking'].includes(voiceStatus)
  const voiceStatusLabel: Record<VoiceStatus, string> = {
    standby: 'Standby · say “Hello Sarthi”',
    wake_detected: 'Wake phrase detected',
    idle: 'Ready to listen',
    listening: 'Listening',
    processing: 'Processing audio',
    understanding: 'Understanding your request',
    awaiting_confirmation: 'Awaiting confirmation',
    speaking: 'Speaking',
    success: 'Complete',
    error: 'Needs attention',
  }
  const canStartVoice = !voiceBusy && voiceStatus !== 'awaiting_confirmation'
  const micButtonLabel = voiceStatus === 'listening' ? 'Tap to finish speaking'
    : voiceBusy ? 'Sarthi is working…'
      : voiceStatus === 'awaiting_confirmation' ? 'Confirm or cancel below'
    : 'Tap to speak'

  const speak = (text: string, language = responseLanguage) => speakTimbre(text, language.toLowerCase() === 'hi-latn' ? 'hi-IN' : language)

  const enableSpeechOutput = async () => {
    try {
      await unlockSpeechPlayback()
      setAudioReady(true)
      setAudioNeedsUnlock(false)
      setError('')
    } catch {
      setAudioNeedsUnlock(true)
      setError('Your browser blocked audio playback. Tap Enable audio, then use Repeat response.')
    }
  }

  const speechPlaybackError = (error: unknown) => {
    if (error instanceof Error && error.name === 'NotAllowedError') {
      setAudioNeedsUnlock(true)
      return 'Your browser blocked automatic audio playback. Tap Enable audio, then tap Repeat response.'
    }
    return error instanceof Error ? error.message : 'Timbre audio could not be played. The text response is still available.'
  }

  const clearRecognition = () => {
    if (recognitionRestartTimer.current !== null) window.clearTimeout(recognitionRestartTimer.current)
    recognitionRestartTimer.current = null
    const recognition = wakeRecognition.current
    wakeRecognition.current = null
    recognitionMode.current = null
    try { recognition?.stop() } catch { /* recognition already stopped */ }
  }

  const startStandbyRecognition = () => {
    if (document.visibilityState !== 'visible' || conversationActive.current || wakeRecognition.current) return
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Recognition) { setWakeSupported(false); return }
    const recognition = new Recognition()
    recognition.lang = 'en-IN'; recognition.continuous = true; recognition.interimResults = true
    let detectedWakePhrase = 'hello sarthi'
    recognitionMode.current = 'standby'; wakeRecognition.current = recognition
    recognition.onresult = (event: any) => {
      const heard = Array.from(event.results as ArrayLike<{ 0: { transcript: string } }>)
        .map((item) => item[0].transcript).join(' ').toLowerCase()
      if (/hello\s+sara?thi|हेलो\s*सारथी|हैलो\s*सारथी/.test(heard)) {
        detectedWakePhrase = heard
        wakeTriggered.current = true
        try { recognition.stop() } catch { /* handled by onend */ }
      }
    }
    recognition.onend = () => {
      if (wakeRecognition.current !== recognition) return
      wakeRecognition.current = null; recognitionMode.current = null
      if (wakeTriggered.current) {
        wakeTriggered.current = false
        conversationActive.current = true
        setWakeEnabled(false)
        setError('')
        const greetingLanguage = speechLanguage(undefined, detectedWakePhrase)
        const greeting = localizedReply('Hello! I’m here. What would you like to know about your deliveries?', 'नमस्ते! मैं यहाँ हूँ। अपनी डिलीवरी के बारे में क्या जानना चाहेंगे?', greetingLanguage)
        setResponseLanguage(greetingLanguage)
        setLastResponse(greeting)
        setVoiceStatus('wake_detected')
        window.setTimeout(() => {
          if (!conversationActive.current) return
          setVoiceStatus('speaking')
          startInterruptRecognition()
          void speak(greeting, greetingLanguage)
            .catch((error: unknown) => { setError(speechPlaybackError(error)); setVoiceStatus('error') })
            .finally(() => { clearRecognition(); if (conversationActive.current) void startCommandRecording() })
        }, 220)
      } else if (document.visibilityState === 'visible' && !conversationActive.current) {
        recognitionRestartTimer.current = window.setTimeout(() => { recognitionRestartTimer.current = null; startStandbyRecognition() }, 650)
      }
    }
    recognition.onerror = (event: any) => {
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        wakeRecognition.current = null; recognitionMode.current = null; setWakeEnabled(false)
        setError('Microphone permission was denied for hands-free wake listening. Allow access in browser settings, then tap Enable hands-free or use the microphone control.')
      }
    }
    try { recognition.start(); setWakeEnabled(true); setVoiceStatus('standby') }
    catch (cause) {
      wakeRecognition.current = null; recognitionMode.current = null; setWakeEnabled(false)
      setError(cause instanceof Error && cause.name === 'NotAllowedError'
        ? 'Microphone permission is needed for hands-free wake listening. Allow access in browser settings, then tap Enable hands-free or use the microphone control.'
        : 'Hands-free wake listening could not start in this browser. Use the microphone control, or allow microphone access and retry.')
    }
  }

  const startInterruptRecognition = () => {
    if (!wakeSupportedRef.current || document.visibilityState !== 'visible' || wakeRecognition.current) return
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Recognition) return
    const recognition = new Recognition()
    recognition.lang = 'en-IN'; recognition.continuous = true; recognition.interimResults = true
    wakeRecognition.current = recognition; recognitionMode.current = 'interrupt'
    recognition.onresult = (event: any) => {
      const heard = Array.from(event.results as ArrayLike<{ 0: { transcript: string } }>)
        .map((item) => item[0].transcript).join(' ').toLowerCase()
      if (isStopNavigationPhrase(heard)) { void stopNavigationByVoice(); return }
      if (isStopPhrase(heard)) stopVoiceSession()
    }
    recognition.onend = () => {
      if (wakeRecognition.current !== recognition) return
      wakeRecognition.current = null; recognitionMode.current = null
      if (conversationActive.current && document.visibilityState === 'visible') {
        recognitionRestartTimer.current = window.setTimeout(() => { recognitionRestartTimer.current = null; startInterruptRecognition() }, 300)
      }
    }
    recognition.onerror = () => { /* playback and manual stop remain available */ }
    try { recognition.start() } catch { wakeRecognition.current = null; recognitionMode.current = null }
  }

  const stopVoiceSession = () => {
    sessionGeneration.current++
    navigationRequestGeneration.current = sessionGeneration.current
    if (navigationStartPending.current) { navigationStartPending.current = false; setNavigationStopVersion((version) => version + 1); setNavigationStartStopId(null) }
    conversationActive.current = false
    recordingProcessing.current = false
    navigationOfferStopId.current = null
    setProposal(null)
    setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false)
    clearRecognition()
    stopSpeaking()
    const activeRecorder = recorder.current
    recorder.current = null
    void activeRecorder?.cancel()
    setVoiceStatus(wakeSupportedRef.current ? 'standby' : 'idle')
    setError('Voice session ended. Say “Hello Sarthi” or tap the microphone to start again.')
    if (wakeSupportedRef.current && document.visibilityState === 'visible') window.setTimeout(() => startStandbyRecognition(), 350)
  }

  const stopNavigationByVoice = async () => {
    navigationStartPending.current = false
    setNavigationStopVersion((version) => version + 1)
    setNavigationStartStopId(null)
    navigationOfferStopId.current = null
    stopSpeaking(); clearRecognition()
    const message = localizedReply('Navigation has ended. Your delivery is unchanged.', 'नेविगेशन समाप्त कर दिया है। आपकी डिलीवरी में कोई बदलाव नहीं हुआ है।', responseLanguage, 'Navigation end kar diya hai. Aapki delivery mein koi badlav nahi hua hai.')
    setLastResponse(message); setHistory((prior): ChatTurn[] => [...prior, { role: 'assistant' as const, content: message }].slice(-12)); setVoiceStatus('speaking')
    if (conversationActive.current) startInterruptRecognition()
    try { await speak(message, responseLanguage) }
    catch (cause) { if (!(cause instanceof Error && cause.name === 'AbortError')) setError(speechPlaybackError(cause)) }
    finally {
      clearRecognition(); setVoiceStatus('success')
      if (conversationActive.current) void startCommandRecording()
    }
  }

  const startCommandRecording = async (preserveProposal = false) => {
    clearRecognition()
    const generation = sessionGeneration.current
    try {
      const nextRecorder = await beginRecording({ autoStop: true, onAutoStop: () => { void finishRecordingRef.current() } })
      if (generation !== sessionGeneration.current) { await nextRecorder.cancel(); return }
      recorder.current = nextRecorder
      setTranscript(''); if (!otpPending && !preserveProposal) setProposal(null); setActionFailed(false); setVoiceStatus(preserveProposal && !(otpPending && !otpEntry) ? 'awaiting_confirmation' : 'listening')
    } catch {
      conversationActive.current = false
      setError('Microphone access is needed. Allow microphone access, then use Retry or the manual controls.')
      setVoiceStatus('error')
    }
  }

  const finishRecording = async () => {
    if (!recorder.current || recordingProcessing.current) return
    recordingProcessing.current = true
    const generation = sessionGeneration.current
    const isCurrent = () => generation === sessionGeneration.current
    setVoiceStatus('processing')
    try {
      const activeRecorder = recorder.current; recorder.current = null
      const clip = await activeRecorder.stop()
      if (!isCurrent()) return
      if (clip.size < 1000) throw new Error('I could not hear speech. Please try again.')
      const stt = await transcribe(clip)
      if (!isCurrent()) return
      if (!stt.transcript.trim()) throw new Error('I could not hear speech in that recording. Please try again.')
      const heard = stt.transcript.trim()
      if (isStopNavigationPhrase(heard)) { await stopNavigationByVoice(); return }
      if (isStopPhrase(heard)) { stopVoiceSession(); return }
      setTranscript(heard)
      const isDigitOnlyReply = /^[\d\s०-९,.-]+$/.test(heard) || /^(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple|शून्य|एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ)(?:[\s-]+(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple|शून्य|एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ))*[.! ]*$/i.test(heard)
      const isShortConfirmation = isAffirmative(heard) || /^(?:no|nope|wrong|repeat|cancel|नहीं|नही|गलत|दोबारा|रद्द|मत करो)[.! ]*$/i.test(heard)
      const language = (otpPending && (isDigitOnlyReply || isShortConfirmation) || proposal?.proposed_action && isShortConfirmation)
        ? responseLanguage
        : speechLanguage(stt.detected_language_code, heard)
      setResponseLanguage(language)
      if (navigationOfferStopId.current !== null) {
        const offeredId = navigationOfferStopId.current
        navigationOfferStopId.current = null
        if (isAffirmative(heard)) {
          const offeredStop = stops.find((stop) => stop.id === offeredId && stop.status === 'pending')
          if (offeredStop) { await performNavigation(offeredStop, language, heard); return }
        }
      }
      if (otpPending && otpStop) {
        if (!otpEntry && /^(yes|yeah|yep|sure|confirm|haan|हाँ|जी|ठीक है|haan ji)[.! ]*$/i.test(heard)) {
          const prompt = localizedReply(`Please tell me the delivery OTP for order ${otpStop.order_number}.`, `कृपया ऑर्डर ${otpStop.order_number} का डिलीवरी OTP बताइए।`, language, `Order ${otpStop.order_number} ka delivery OTP bataiye.`)
          setLastResponse(prompt); setVoiceStatus('speaking'); startInterruptRecognition()
          try { await speak(prompt, language) } catch (cause) { if (!isCurrent()) return; setError(speechPlaybackError(cause)); setVoiceStatus('error') }
          if (!isCurrent()) return
          clearRecognition()
          if (conversationActive.current) void startCommandRecording(true)
          return
        }
        if (otpEntry && /^(yes|yeah|yep|sure|confirm|haan|हाँ|जी|submit|हो)(?:\s+(that's right|that is right|correct|submit it|go ahead|सही है|जमा करो))?[.! ]*$/i.test(heard)) {
          if (actionInFlight.current) return
          actionInFlight.current = true
          setVoiceStatus('processing')
          let updated: Run
          try {
            updated = await applyAction(otpStop.id, 'delivered', otpEntry, heard)
          } catch (cause) {
            actionInFlight.current = false
            if (!isCurrent()) return
            const detail = cause instanceof Error ? cause.message : localizedReply('OTP verification failed. Please try again.', 'OTP सत्यापन नहीं हो सका। कृपया फिर से कोशिश करें।', language)
            const recovery = localizedReply(`That OTP was not accepted: ${detail}. Please repeat the OTP.`, `यह OTP स्वीकार नहीं हुआ: ${detail}। कृपया OTP फिर से बताइए।`, language, `OTP accept nahi hua: ${detail}. Please digits phir se bataiye.`)
            setError(recovery); setLastResponse(recovery); setOtpEntry(''); setOtpConfirmed(false); setVoiceStatus('error')
            try { await speak(recovery, language) } catch { if (!isCurrent()) return /* Keep the recovery text visible if speech is unavailable. */ }
            if (conversationActive.current) void startCommandRecording(true)
            return
          }
          actionInFlight.current = false
          setRun(updated); setProposal(null); setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false)
          const nextEligible = [...updated.stops].filter((stop) => stop.status === 'pending').sort((left, right) => left.sequence - right.sequence || left.id - right.id)[0]
          setSelectedStopId(nextEligible?.id ?? null)
          if (!isCurrent()) return
          navigationOfferStopId.current = nextEligible?.id ?? null
          const nextMessage = nextEligible ? localizedReply(` Your next delivery is order ${nextEligible.order_number} for ${nextEligible.customer_name}. Would you like directions?`, `अगली डिलीवरी ऑर्डर ${nextEligible.order_number}, ${nextEligible.customer_name} की है। क्या आप दिशाएँ खोलना चाहेंगे?`, language, `Aapki next delivery order ${nextEligible.order_number}, ${nextEligible.customer_name} ki hai. Kya main directions dikhaun?`) : ''
          const message = localizedReply(`Perfect! The OTP is verified. Order ${otpStop.order_number} for ${otpStop.customer_name} is complete.${nextMessage}`, `बहुत बढ़िया! OTP सत्यापित हो गया है। ऑर्डर ${otpStop.order_number}, ${otpStop.customer_name} की डिलीवरी पूरी हो गई है।${nextMessage}`, language, `Perfect! OTP verify ho gaya. Order ${otpStop.order_number} for ${otpStop.customer_name} successfully complete ho gaya.${nextMessage}`)
          setLastResponse(message); setVoiceStatus('speaking'); startInterruptRecognition()
          try { await speak(message, language); if (!isCurrent()) return; setVoiceStatus('success') }
          catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') return; setError(`Delivery was completed, but ${speechPlaybackError(cause).toLowerCase()}`); setVoiceStatus('error') }
          finally { if (isCurrent()) { clearRecognition(); if (conversationActive.current) void startCommandRecording() } }
          return
        }
        if (/^(no|nope|wrong|repeat|नहीं|नही|गलत|दोबारा)[.! ]*$/i.test(heard)) {
          setOtpEntry(''); setOtpConfirmed(false)
          const prompt = localizedReply('Okay, I will not submit that. Please repeat the OTP.', 'ठीक है, मैं इसे जमा नहीं करूँगा। कृपया OTP फिर से बताइए।', language, 'Theek hai, main ise submit nahi karunga. OTP phir se bataiye.')
          setLastResponse(prompt); setVoiceStatus('speaking'); startInterruptRecognition()
          try { await speak(prompt, language) } catch (cause) { if (!isCurrent()) return; setError(speechPlaybackError(cause)); setVoiceStatus('error') }
          if (!isCurrent()) return
          clearRecognition()
          if (conversationActive.current) void startCommandRecording(true)
          return
        }
        if (/^(cancel|रद्द|मत करो)[.! ]*$/i.test(heard)) { setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setProposal(null); setVoiceStatus('success'); if (conversationActive.current) void startCommandRecording(); return }
        const digits = normalizeOtpSpeech(heard)
        if (digits.length === otpStop.otp_length) {
          setOtpEntry(digits); setOtpConfirmed(false)
          setError('')
          setLastResponse(localizedReply(`Checking the OTP for order ${otpStop.order_number}…`, `ऑर्डर ${otpStop.order_number} का OTP जाँच रहे हैं…`, language, `Order ${otpStop.order_number} ka OTP check kar rahe hain.`))
          if (actionInFlight.current) return
          actionInFlight.current = true
          setVoiceStatus('processing')
          let updated: Run
          try {
            // Let React paint the recognized digits into the visible OTP field before auto-verifying.
            await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
            updated = await applyAction(otpStop.id, 'delivered', digits, heard)
          } catch (cause) {
            actionInFlight.current = false
            if (!isCurrent()) return
            const detail = cause instanceof Error ? cause.message : localizedReply('OTP verification failed. Please check the digits and try again.', 'OTP सत्यापन नहीं हो सका। अंक जाँचकर फिर कोशिश करें।', language)
            const recovery = localizedReply(`That OTP was not accepted: ${detail}. The heard digits remain in the box; correct them or speak the OTP again.`, `यह OTP स्वीकार नहीं हुआ: ${detail}। सुने गए अंक बॉक्स में हैं; उन्हें सुधारें या OTP फिर से बोलें।`, language, `OTP accept nahi hua: ${detail}. Sune gaye digits box mein hain; unhe correct karein ya OTP phir se boliye.`)
            setError(recovery); setLastResponse(recovery); setOtpEntry(digits); setOtpConfirmed(false); setVoiceStatus('error')
            try { await speak(recovery, language) } catch { if (!isCurrent()) return }
            if (conversationActive.current) void startCommandRecording(true)
            return
          }
          actionInFlight.current = false
          setRun(updated); setProposal(null); setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false)
          const nextEligible = [...updated.stops].filter((stop) => stop.status === 'pending').sort((left, right) => left.sequence - right.sequence || left.id - right.id)[0]
          setSelectedStopId(nextEligible?.id ?? null)
          if (!isCurrent()) return
          navigationOfferStopId.current = nextEligible?.id ?? null
          const nextMessage = nextEligible ? localizedReply(` Your next delivery is order ${nextEligible.order_number} for ${nextEligible.customer_name}. Would you like directions?`, `अगली डिलीवरी ऑर्डर ${nextEligible.order_number}, ${nextEligible.customer_name} की है। क्या आप दिशाएँ खोलना चाहेंगे?`, language, `Aapki next delivery order ${nextEligible.order_number}, ${nextEligible.customer_name} ki hai. Kya main directions dikhaun?`) : ''
          const message = localizedReply(`OTP verified. Order ${otpStop.order_number} for ${otpStop.customer_name} is complete.${nextMessage}`, `OTP सत्यापित हो गया। ऑर्डर ${otpStop.order_number}, ${otpStop.customer_name} की डिलीवरी पूरी हो गई है।${nextMessage}`, language, `OTP verify ho gaya. Order ${otpStop.order_number} for ${otpStop.customer_name} complete ho gaya.${nextMessage}`)
          setLastResponse(message); setVoiceStatus('speaking'); startInterruptRecognition()
          try { await speak(message, language); if (!isCurrent()) return; setVoiceStatus('success') }
          catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') return; setError(`Delivery was completed, but ${speechPlaybackError(cause).toLowerCase()}`); setVoiceStatus('error') }
          finally { if (isCurrent()) { clearRecognition(); if (conversationActive.current) void startCommandRecording() } }
          return
        }
        setOtpEntry(digits.slice(0, otpStop.otp_length))
        setOtpConfirmed(false)
        const retryPrompt = digits
          ? localizedReply(`I heard ${digits.length} digits. The OTP box is still open; please say all ${otpStop.otp_length} digits again or correct them there.`, `मुझे ${digits.length} अंक सुनाई दिए। OTP बॉक्स खुला है; कृपया सभी ${otpStop.otp_length} अंक फिर से बोलें या वहीं सुधारें।`, language, `${digits.length} digits sune. OTP box khula hai; saare ${otpStop.otp_length} digits phir se boliye ya box mein correct karein.`)
          : localizedReply(`I could not hear the OTP clearly. The OTP box is still open; say all ${otpStop.otp_length} digits again or enter them there.`, `OTP साफ़ सुनाई नहीं दिया। OTP बॉक्स खुला है; सभी ${otpStop.otp_length} अंक फिर से बोलें या वहीं भरें।`, language, `OTP clear nahi suna. OTP box khula hai; saare ${otpStop.otp_length} digits phir se boliye ya box mein daaliye.`)
        setLastResponse(retryPrompt); setError(''); setVoiceStatus('speaking'); startInterruptRecognition()
        try { await speak(retryPrompt, language) } catch (cause) { if (!isCurrent()) return; setError(speechPlaybackError(cause)); setVoiceStatus('error') }
        if (!isCurrent()) return
        clearRecognition()
        if (conversationActive.current) void startCommandRecording(true)
        return
      }
      if (proposal?.proposed_action && !otpPending) {
        if (isAffirmative(heard)) {
          if (proposal.proposed_action === 'delivered') {
            const otpTarget = current
            if (!otpTarget || otpTarget.status === 'delivered') {
              const message = localizedReply('I cannot find an eligible selected delivery to verify. Please select its customer details and try again.', 'सत्यापन के लिए चुनी हुई योग्य डिलीवरी नहीं मिली। कृपया ग्राहक का विवरण चुनकर फिर कोशिश करें।', language, 'Verify karne ke liye selected delivery nahi mili. Customer details kholkar phir try karein.')
              setError(message); setLastResponse(message); setVoiceStatus('error')
              try { await speak(message, language) } catch { /* Keep the recovery text visible. */ }
              if (conversationActive.current) void startCommandRecording()
              return
            }
            setOtpStopId(otpTarget.id); setSelectedStopId(otpTarget.id); setPage('deliveries')
            setOtpPending(true); setOtpEntry(''); setOtpConfirmed(false); setError('')
            const prompt = localizedReply(`Please tell me the delivery OTP for order ${otpTarget.order_number}, ${otpTarget.customer_name}.`, `कृपया ऑर्डर ${otpTarget.order_number}, ${otpTarget.customer_name} का डिलीवरी OTP बताइए।`, language, `Order ${otpTarget.order_number}, ${otpTarget.customer_name} ka delivery OTP bataiye.`)
            setLastResponse(prompt); setVoiceStatus('speaking'); startInterruptRecognition()
            try { await speak(prompt, language) } catch (cause) { if (!isCurrent()) return; setError(speechPlaybackError(cause)); setVoiceStatus('error') }
            if (!isCurrent()) return
            clearRecognition()
            if (conversationActive.current) void startCommandRecording(true)
          } else {
            await confirmProposal()
          }
          return
        }
        if (/^(no|nope|cancel|नहीं|नही|रद्द|मत करो)[.! ]*$/i.test(heard)) {
          setProposal(null); setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false)
          const message = localizedReply('Okay, I cancelled that action.', 'ठीक है, मैंने यह कार्रवाई रद्द कर दी है।', language)
          setLastResponse(message); setVoiceStatus('speaking'); startInterruptRecognition()
          try { await speak(message, language) } catch (cause) { if (!isCurrent()) return; setError(speechPlaybackError(cause)); setVoiceStatus('error') }
          if (!isCurrent()) return
          clearRecognition()
          if (conversationActive.current) void startCommandRecording()
          return
        }
        setProposal(null); setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false)
        await interpretTranscript(heard, language)
        return
      }
      await interpretTranscript(heard, language)
    } catch (e) {
      if (!isCurrent()) return
      setError(e instanceof Error ? e.message : 'Voice request failed')
      setVoiceStatus('error')
    } finally {
      recordingProcessing.current = false
    }
  }

  finishRecordingRef.current = finishRecording

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        sessionGeneration.current++
        clearRecognition()
        if (recorder.current) { const active = recorder.current; recorder.current = null; void active.cancel() }
        stopSpeaking()
        conversationActive.current = false
        setWakeEnabled(false)
        setVoiceStatus('idle')
      } else if (welcomeComplete && !conversationActive.current) startStandbyRecognition()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [wakeSupported, welcomeComplete])

  const dismissProposal = () => {
    navigationOfferStopId.current = null
    setProposal(null)
    setTranscript('')
    setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false)
    setActionFailed(false)
    if (conversationActive.current) void startCommandRecording()
    else setVoiceStatus(wakeSupported ? 'standby' : 'idle')
    setError('')
  }

  const interpretTranscript = async (heard: string, language: string) => {
    const generation = sessionGeneration.current
    const isCurrent = () => generation === sessionGeneration.current
    setError('')
    setVoiceStatus('understanding')
    setActionFailed(false)
    try {
      // Keep delivery verification available even when the hosted decision model is rate-limited.
      const isDeliveryCompletion = /\b(?:delivered|delivery(?:\s+is)?\s+(?:done|complete(?:d)?)|deliver(?:y)?\s+kar\s+(?:diya|di)|deliver(?:y)?\s+ho\s+gaya)\b|डिलीवर\s+कर\s+दिया|डिलीवरी\s+पूरी|पहुँचा\s+दिया|पहुंचा\s+दिया/i.test(heard)
      if (isDeliveryCompletion) {
        const spokenOrder = heard.match(/\b10\d{2}\b/)?.[0]
        const orderStop = spokenOrder ? orderedStops.find((stop) => stop.order_number === spokenOrder && stop.status !== 'delivered') : undefined
        const namedStop = orderedStops.find((stop) => stop.status !== 'delivered' && stop.customer_name.split(/\s+/).some((part) => part.length > 2 && heard.toLowerCase().includes(part.toLowerCase())))
        const target = orderStop ?? namedStop ?? current
        if (target && target.status !== 'delivered') {
          const hasOtpMarker = /\b(?:otp|code|pin)\b|ओटीपी|कोड/i.test(heard)
          const digits = hasOtpMarker ? normalizeOtpSpeech(heard) : ''
          setSelectedStopId(target.id)
          setPage('deliveries')
          setOtpStopId(target.id)
          setOtpPending(true)
          setOtpEntry(digits)
          setOtpConfirmed(false)
          const prompt = localizedReply(`Please tell me the ${target.otp_length}-digit delivery OTP for order ${target.order_number}.`, `कृपया ऑर्डर ${target.order_number} का ${target.otp_length} अंकों का OTP बताइए।`, language, `Order ${target.order_number} ka ${target.otp_length}-digit delivery OTP bataiye.`)
          setProposal({ intent: 'DELIVERY_COMPLETED', confidence: 1, extracted_details: { otp: digits }, response_text: prompt, proposed_action: 'delivered', requires_confirmation: false, understanding_engine: 'local OTP verification' })
          if (hasOtpMarker && digits.length === target.otp_length) {
            setVoiceStatus('processing')
            try {
              const updated = await applyAction(target.id, 'delivered', digits, heard)
              if (!isCurrent()) return
              setRun(updated); setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false); setProposal(null)
              const confirmation = localizedReply(`OTP verified. Order ${target.order_number} for ${target.customer_name} is complete.`, `OTP सत्यापित हो गया। ऑर्डर ${target.order_number}, ${target.customer_name} की डिलीवरी पूरी हो गई है।`, language, `OTP verify ho gaya. Order ${target.order_number} for ${target.customer_name} complete ho gaya.`)
              setLastResponse(confirmation); setVoiceStatus('success')
              try { await speak(confirmation, language) } catch { /* Keep the verified delivery state if speech playback fails. */ }
            } catch (cause) {
              if (!isCurrent()) return
              const detail = cause instanceof Error ? cause.message : 'The code did not match.'
              const recovery = localizedReply(`That code was not accepted (${detail}). The delivery is still pending; correct the digits in the OTP box or say them again.`, `यह कोड स्वीकार नहीं हुआ (${detail})। डिलीवरी अभी पूरी नहीं हुई है; OTP बॉक्स में अंक सुधारें या फिर से बोलें।`, language, `Code accept nahi hua (${detail}). Delivery pending hai; OTP box mein digits correct karein ya phir se boliye.`)
              setError(recovery); setLastResponse(recovery); setVoiceStatus('error')
              try { await speak(recovery, language) } catch { /* Keep the correction instructions visible if TTS is unavailable. */ }
              if (conversationActive.current) void startCommandRecording(true)
            }
          } else {
            const message = hasOtpMarker ? localizedReply(`I heard a code, but it must contain ${target.otp_length} digits. Check the OTP box and correct it.`, `कोड सुना, लेकिन इसमें ${target.otp_length} अंक होने चाहिए। OTP बॉक्स में जाँचकर सुधारें।`, language, `Code suna, lekin ${target.otp_length} digits hone chahiye. OTP box mein check karke correct karein.`) : prompt
            setLastResponse(message); setVoiceStatus('speaking')
            try { await speak(message, language); if (isCurrent()) setVoiceStatus('awaiting_confirmation') } catch { if (isCurrent()) setVoiceStatus('awaiting_confirmation') }
            if (conversationActive.current) void startCommandRecording(true)
          }
          return
        }
      }
      const navigationRequest = /\b(?:navigate|directions|route)\b|नेविगेट|रास्ता|दिशा/i.test(heard)
      if (navigationRequest && isCurrentDeliveryPhrase(heard)) {
        if (!current) {
          const message = localizedReply('There is no current delivery to navigate to.', 'अभी नेविगेट करने के लिए कोई मौजूदा डिलीवरी नहीं है।', language)
          setLastResponse(message); setVoiceStatus('error'); void speak(message, language).catch(() => undefined)
        } else {
          await performNavigation(current, language, heard)
        }
        return
      }
      const result = await understand(heard, language, selectedStopId, history)
      if (!isCurrent()) return
      const navigationIsActive = navigationSnapshot.state === 'active' || navigationSnapshot.state === 'paused'
      if (['STOP_NAVIGATION', 'CANCEL_NAVIGATION'].includes(result.intent)) {
        setHistory((prior): ChatTurn[] => [...prior, { role: 'user' as const, content: heard }].slice(-12))
        await stopNavigationByVoice()
        return
      }
      if (['PAUSE_NAVIGATION', 'RESUME_NAVIGATION'].includes(result.intent)) {
        const shouldPause = result.intent === 'PAUSE_NAVIGATION'
        if (!navigationIsActive || shouldPause === (navigationSnapshot.state === 'paused')) {
          const unavailable = !navigationIsActive ? localizedReply('There is no active route to control.', 'अभी कोई सक्रिय मार्ग नहीं है।', language, 'Abhi koi active route nahi hai.') : shouldPause ? localizedReply('Navigation is already paused.', 'नेविगेशन पहले से रुका हुआ है।', language, 'Navigation pehle se paused hai.') : localizedReply('Navigation is already running.', 'नेविगेशन पहले से चल रहा है।', language, 'Navigation pehle se chal raha hai.')
          setHistory((prior): ChatTurn[] => [...prior, { role: 'user' as const, content: heard }, { role: 'assistant' as const, content: unavailable }].slice(-12)); setLastResponse(unavailable); void speakNavigationGuidance(unavailable)
        } else {
          const action = shouldPause ? 'pause' : 'resume'
          const message = shouldPause ? localizedReply('Navigation is paused. Say resume when you are ready.', 'नेविगेशन रोक दिया है। तैयार होने पर फिर शुरू करने को कहें।', language, 'Navigation pause kar diya hai. Ready hon to resume kahiye.') : localizedReply('Navigation is resuming.', 'नेविगेशन फिर से शुरू हो रहा है।', language, 'Navigation phir se resume ho raha hai.')
          const requestId = navigationCommandId + 1; setNavigationCommandId(requestId); setNavigationCommand({ action, requestId })
          setHistory((prior): ChatTurn[] => [...prior, { role: 'user' as const, content: heard }, { role: 'assistant' as const, content: message }].slice(-12)); setLastResponse(message); void speakNavigationGuidance(message)
        }
        return
      }
      if (['REPEAT_DIRECTIONS', 'CURRENT_TURN_QUERY', 'REMAINING_ROUTE_QUERY'].includes(result.intent)) {
        let message = ''
        if (!navigationIsActive) message = localizedReply('There is no active route guidance yet. Ask for directions first.', 'अभी कोई सक्रिय मार्गदर्शन नहीं है। पहले दिशाएँ माँगें।', language, 'Abhi active route guidance nahi hai. Pehle directions maangiye.')
        else if (result.intent === 'REMAINING_ROUTE_QUERY') {
          if (navigationSnapshot.metersRemaining === null) message = localizedReply('The remaining distance is not available yet.', 'बाकी दूरी अभी उपलब्ध नहीं है।', language, 'Remaining distance abhi available nahi hai.')
          else { const metres = Math.round(navigationSnapshot.metersRemaining); const distance = metres >= 1000 ? `${(metres / 1000).toFixed(1)} kilometres` : `${metres} metres`; message = localizedReply(`${distance} remain on this route.`, `इस मार्ग पर ${distance} बाकी हैं।`, language, `Is route par ${distance} baaki hain.`) }
        } else message = navigationSnapshot.instruction || localizedReply('The next route instruction is not available yet.', 'अगला मार्ग निर्देश अभी उपलब्ध नहीं है।', language, 'Agla route instruction abhi available nahi hai.')
        setHistory((prior): ChatTurn[] => [...prior, { role: 'user' as const, content: heard }, { role: 'assistant' as const, content: message }].slice(-12)); setLastResponse(message); void speakNavigationGuidance(message)
        return
      }
      const targetText = `${Object.values(result.extracted_details).join(' ')} ${heard}`.toLowerCase()
      // Generic references such as “the current order” should resolve to the
      // rider's selected/active stop. Do not let model-generated entity guesses
      // turn that request into a false multi-customer match.
      const asksForCurrent = isCurrentDeliveryPhrase(heard)
      const orderHint = Object.entries(result.extracted_details).find(([key]) => /order(_number|_id)?/i.test(key))?.[1]
      const nameHint = Object.entries(result.extracted_details).find(([key]) => /customer|recipient|person/i.test(key))?.[1]
      const spokenOrder = heard.match(/\b\d{4,}\b/)?.[0]
      const requestedOrder = spokenOrder ?? (asksForCurrent ? undefined : orderHint ?? targetText.match(/\b\d{4,}\b/)?.[0])
      const orderMatch = requestedOrder ? orderedStops.find((stop) => stop.order_number.toLowerCase() === requestedOrder.toLowerCase().replace(/^#/, '')) : undefined
      const spokenText = heard.toLowerCase()
      const spokenTokens = new Set(spokenText.match(/[\p{L}]+/gu) ?? [])
      const nameMatches = orderedStops.filter((stop) => stop.customer_name.toLowerCase().split(/\s+/).some((part) => part.length > 3 && spokenTokens.has(part)))
      const nameMatch = nameMatches.length === 1 ? nameMatches[0] : undefined
      const asksForNext = result.intent === 'NEXT_STOP_QUERY' || (result.intent === 'NAVIGATE_TO_STOP' && /\b(next|upcoming|agla|agli)\b/i.test(heard))
      const unresolvedOrder = Boolean(requestedOrder && !orderMatch)
      const genericName = !nameHint || /^(customer|next customer|current customer|the customer|current order|current delivery|this order|this delivery)$/i.test(nameHint.trim())
      const unresolvedName = Boolean(!asksForCurrent && nameHint && !genericName && !nameMatch)
      const missingExplicitTarget = unresolvedOrder || unresolvedName
      const matchedStop = asksForNext ? activeStop : orderMatch ?? nameMatch ?? (missingExplicitTarget ? null : current)
      const ambiguousTarget = !asksForCurrent && nameMatches.length > 1 && ['call_customer', 'directions', 'delivered', 'contact_attempt', 'wrong_address', 'reschedule'].includes(result.proposed_action ?? '')
      if (ambiguousTarget) {
        result.intent = 'UNCLEAR'; result.proposed_action = null; result.requires_confirmation = false
        result.response_text = localizedReply('I found more than one matching delivery. Please say the customer’s full name or order number.', 'एक से अधिक डिलीवरी मिलीं। कृपया ग्राहक का पूरा नाम या ऑर्डर नंबर बताइए।', language)
      }
      if (missingExplicitTarget) {
        result.intent = 'UNCLEAR'; result.proposed_action = null; result.requires_confirmation = false
        result.response_text = localizedReply('I could not find that customer or order in your delivery list. Please say another name or the order number.', 'मुझे आपकी डिलीवरी सूची में यह ग्राहक या ऑर्डर नहीं मिला। कृपया दूसरा नाम या ऑर्डर नंबर बताइए।', language)
      }
      if (matchedStop && !ambiguousTarget) setSelectedStopId(matchedStop.id)
      if (result.proposed_action === 'delivered' && !matchedStop) {
        result.intent = 'UNCLEAR'; result.proposed_action = null; result.requires_confirmation = false
        result.response_text = localizedReply('There is no eligible delivery to complete right now.', 'अभी पूरी करने के लिए कोई योग्य डिलीवरी नहीं है।', language)
      }
      if (result.proposed_action === 'delivered') {
        setOtpEntry(''); setOtpPending(true); setOtpConfirmed(false)
        const otpTarget = matchedStop ?? current
        setOtpStopId(otpTarget?.id ?? null)
        if (otpTarget) { setSelectedStopId(otpTarget.id); setPage('deliveries') }
        result.response_text = localizedReply(`Please tell me the delivery OTP for order ${matchedStop?.order_number ?? current?.order_number ?? ''}.`, `कृपया ऑर्डर ${matchedStop?.order_number ?? current?.order_number ?? ''} का डिलीवरी OTP बताइए।`, language, `Order ${matchedStop?.order_number ?? current?.order_number ?? ''} ka delivery OTP bataiye.`)
      }
      if (result.intent === 'CALL_CUSTOMER' && !matchedStop?.customer_phone) result.response_text += localizedReply(' The customer phone number is not saved. I will open delivery details so you can add it.', ' ग्राहक का फ़ोन नंबर सेव नहीं है। मैं डिलीवरी विवरण खोल रहा हूँ ताकि आप नंबर जोड़ सकें।', language)
      if (result.proposed_action === 'directions' && !matchedStop) { result.intent = 'UNCLEAR'; result.proposed_action = null; result.requires_confirmation = false; result.response_text = localizedReply('Which delivery should I open directions for?', 'किस डिलीवरी के लिए दिशाएँ खोलूँ?', language) }
      if (result.proposed_action === 'directions' && matchedStop) {
        await performNavigation(matchedStop, language, heard)
        return
      }
      setProposal(result)
      setUnderstandingEngine(result.understanding_engine)
      const spokenResponse = result.intent === 'REPEAT_RESPONSE' && lastResponse ? lastResponse : result.response_text
      setLastResponse(spokenResponse)
      setHistory((prior): ChatTurn[] => [...prior, { role: 'user' as const, content: heard }, { role: 'assistant' as const, content: spokenResponse }].slice(-12))
      setVoiceStatus('speaking')
      try {
        if (conversationActive.current) startInterruptRecognition()
        await speak(spokenResponse, language)
        if (!isCurrent()) return
        clearRecognition()
        setVoiceStatus(result.proposed_action ? 'awaiting_confirmation' : 'success')
        if (conversationActive.current) void startCommandRecording(Boolean(result.proposed_action))
      } catch (e) {
        if (!isCurrent()) return
        clearRecognition()
        if (e instanceof Error && e.name === 'AbortError') return
        setError(speechPlaybackError(e))
        setVoiceStatus('error')
        if (conversationActive.current && result.proposed_action) void startCommandRecording(true)
        else if (conversationActive.current) void startCommandRecording()
      }
      if (!result.proposed_action && !conversationActive.current && wakeSupported) window.setTimeout(() => startStandbyRecognition(), 350)
    } catch (e) {
      if (!isCurrent()) return
      setError(e instanceof Error ? e.message : 'Could not understand that request. Please try again.')
      setVoiceStatus('error')
    }
  }

  const handleVoice = async () => {
    void enableSpeechOutput()
    setError('')
    if (voiceBusy || voiceStatus === 'awaiting_confirmation') return
    if (voiceStatus === 'listening') { await finishRecording(); return }
    clearRecognition()
    conversationActive.current = false
    await startCommandRecording()
  }

  const repeatResponse = async () => {
    if (!lastResponse || voiceBusy) return
    await enableSpeechOutput()
    setError('')
    setVoiceStatus('speaking')
    try {
      if (conversationActive.current) startInterruptRecognition()
      await speak(lastResponse, responseLanguage)
      clearRecognition()
      setVoiceStatus(proposal?.proposed_action ? 'awaiting_confirmation' : 'success')
      if (conversationActive.current) void startCommandRecording(Boolean(proposal?.proposed_action))
    } catch (e) {
      clearRecognition()
      if (e instanceof Error && e.name === 'AbortError') return
      setError(speechPlaybackError(e))
      setVoiceStatus('error')
    }
    if (!proposal?.proposed_action && !conversationActive.current && wakeSupported) window.setTimeout(() => startStandbyRecognition(), 350)
  }

  const retryVoice = () => {
    if (actionFailed && proposal) { void confirmProposal(); return }
    if (lastResponse) { void repeatResponse(); return }
    if (conversationActive.current) { void startCommandRecording(); return }
    void handleVoice()
  }

  const performNavigation = async (targetStop: Stop, language: string, riderText?: string) => {
    if (navigationInFlight.current) return
    navigationInFlight.current = true
    navigationRequestGeneration.current = sessionGeneration.current
    setSelectedStopId(targetStop.id)
    setProposal(null)
    if (!targetStop.address.trim()) {
      navigationStartPending.current = false
      const detail = localizedReply('This delivery has no saved address. Use the Map screen to review its details.', 'इस डिलीवरी का पता सेव नहीं है। विवरण देखने के लिए मैप स्क्रीन खोलें।', language)
      setNavigationStartStopId(null); setError(detail); setPage('map'); setVoiceStatus('error'); navigationInFlight.current = false
      if (conversationActive.current) { startInterruptRecognition(); void speak(detail, language).catch(() => undefined).finally(() => { clearRecognition(); if (conversationActive.current) void startCommandRecording() }) }
      return
    }
    setVoiceStatus('processing')
    navigationStartPending.current = true
    setNavigationStartStopId(targetStop.id)
    if (conversationActive.current) startInterruptRecognition()
    setPage('map')
    const message = localizedReply(`Calculating in-app directions to ${targetStop.customer_name}'s saved delivery address.`, `${targetStop.customer_name} के सेव किए गए पते के लिए इन-ऐप दिशाएँ निकाल रहा हूँ।`, language, `${targetStop.customer_name} ke saved address ke liye in-app directions nikaal raha hoon.`)
    setLastResponse(message)
    setHistory((prior): ChatTurn[] => [...prior, ...(riderText ? [{ role: 'user' as const, content: riderText }] : []), { role: 'assistant' as const, content: message }].slice(-12))
    navigationInFlight.current = false
  }

  const onNavigationStarted = (instruction: string) => {
    if (navigationRequestGeneration.current !== sessionGeneration.current) return
    navigationStartPending.current = false
    setNavigationStartStopId(null)
    const message = localizedReply(`In-app directions are active. ${instruction}`, `इन-ऐप दिशाएँ शुरू हैं। ${instruction}`, responseLanguage, `In-app directions shuru hain. ${instruction}`)
    setLastResponse(message)
    setHistory((prior): ChatTurn[] => [...prior, { role: 'assistant' as const, content: message }].slice(-12))
    setVoiceStatus('speaking')
    if (conversationActive.current) startInterruptRecognition()
    void speak(message, responseLanguage).then(() => {
      clearRecognition(); setVoiceStatus('success')
      if (conversationActive.current) void startCommandRecording()
      else if (wakeSupported) window.setTimeout(() => startStandbyRecognition(), 350)
    }).catch((cause: unknown) => {
      clearRecognition()
      if (cause instanceof Error && cause.name === 'AbortError') return
      setError(speechPlaybackError(cause)); setVoiceStatus('error')
      if (conversationActive.current) void startCommandRecording()
    })
  }

  const onNavigationError = (message: string) => {
    if (navigationRequestGeneration.current !== sessionGeneration.current) return
    navigationStartPending.current = false
    setNavigationStartStopId(null)
    setError(message); setLastResponse(message); setVoiceStatus('error')
    if (conversationActive.current) {
      startInterruptRecognition()
      void speak(message, responseLanguage).catch(() => undefined).finally(() => {
        clearRecognition()
        if (conversationActive.current) void startCommandRecording()
      })
    }
  }

  const speakNavigationGuidance = async (instruction: string) => {
    const generation = sessionGeneration.current
    if (recorder.current) {
      const pendingRecorder = recorder.current
      recorder.current = null
      await pendingRecorder.cancel()
    }
    const inConversation = conversationActive.current
    if (inConversation) startInterruptRecognition()
    setVoiceStatus('speaking')
    try {
      await speak(instruction, responseLanguage)
      if (generation !== sessionGeneration.current) return
      setVoiceStatus('success')
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return
      if (generation !== sessionGeneration.current) return
      setError(speechPlaybackError(cause)); setVoiceStatus('error')
    } finally {
      if (generation === sessionGeneration.current) {
        clearRecognition()
        if (conversationActive.current) void startCommandRecording()
      }
    }
  }
  const confirmProposal = async () => {
    if (!proposal?.proposed_action) return
    const targetStop = proposal.proposed_action === 'delivered' && otpPending ? otpStop : current
    if (!targetStop) return
    setError('')
    setActionFailed(false)
    if (proposal.proposed_action === 'call_customer') {
      if (!targetStop.customer_phone) {
        setSelectedStopId(targetStop.id); setPage('deliveries'); setPhoneEditorOpen(true)
        const message = localizedReply(`No customer number is saved for ${targetStop.customer_name}. Add it in delivery details, then use Call customer.`, `${targetStop.customer_name} का फ़ोन नंबर सेव नहीं है। डिलीवरी विवरण में नंबर जोड़ें, फिर ग्राहक को कॉल करें।`, responseLanguage)
        setLastResponse(message); setError(message); setVoiceStatus('error')
        try { await speak(message, responseLanguage) } catch { /* Text and the manual phone editor remain available. */ }
        if (conversationActive.current) void startCommandRecording()
        return
      }
      window.location.href = `tel:${targetStop.customer_phone}`
      setProposal(null)
      setVoiceStatus('success')
      if (conversationActive.current) void startCommandRecording()
      else if (wakeSupported) window.setTimeout(() => startStandbyRecognition(), 350)
      return
    }
    if (proposal.proposed_action === 'directions') {
      await performNavigation(targetStop, responseLanguage)
      return
    }
    let otp: string | undefined
    if (proposal.proposed_action === 'delivered') {
      if (!otpPending) { setOtpStopId(targetStop.id); setSelectedStopId(targetStop.id); setPage('deliveries'); setOtpPending(true); setOtpEntry(''); setOtpConfirmed(false); return }
      if (!otpConfirmed || otpEntry.length !== targetStop.otp_length) { setError(`Enter the complete ${targetStop.otp_length}-digit delivery OTP and confirm it before submitting.`); return }
      otp = otpEntry.trim()
    }
    if (actionInFlight.current) return
    setVoiceStatus('processing')
    actionInFlight.current = true
    const actionGeneration = sessionGeneration.current
    try {
      const updated = await applyAction(targetStop.id, proposal.proposed_action, otp, transcript)
      setRun(updated); setProposal(null); setTranscript(''); setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false)
      if (proposal.proposed_action === 'delivered') {
        const nextEligible = [...updated.stops].filter((stop) => stop.status === 'pending').sort((left, right) => left.sequence - right.sequence || left.id - right.id)[0]
        setSelectedStopId(nextEligible?.id ?? null)
        navigationOfferStopId.current = nextEligible?.id ?? null
      }
      if (actionGeneration !== sessionGeneration.current) return
      const actionMessage = (() => {
        const order = `order ${targetStop.order_number} for ${targetStop.customer_name}`
        const hindiOrder = `ऑर्डर ${targetStop.order_number}, ${targetStop.customer_name}`
        switch (proposal.proposed_action) {
          case 'contact_attempt': return localizedReply(`Customer unreachable has been recorded for ${order}.`, `${hindiOrder} के लिए ग्राहक से संपर्क न हो पाने की बात दर्ज कर दी गई है।`, responseLanguage, `${order} ke liye customer unreachable record kar diya hai.`)
          case 'wrong_address': return localizedReply(`The address issue has been recorded for ${order}.`, `${hindiOrder} के लिए पते की समस्या दर्ज कर दी गई है।`, responseLanguage, `${order} ke liye address issue record kar diya hai.`)
          case 'reschedule': return localizedReply(`The reschedule request has been recorded for ${order}. No new delivery date was set.`, `${hindiOrder} के लिए डिलीवरी की तारीख बदलने का अनुरोध दर्ज किया गया है। कोई नई तारीख तय नहीं हुई है।`, responseLanguage, `${order} ke liye reschedule request record kar di hai. Koi nayi delivery date set nahi hui.`)
          case 'delivered': {
            const next = [...updated.stops].filter((stop) => stop.status === 'pending').sort((left, right) => left.sequence - right.sequence || left.id - right.id)[0]
            return localizedReply(`${order} is verified and marked delivered.${next ? ` Your next delivery is order ${next.order_number} for ${next.customer_name}. Would you like directions?` : ''}`, `${hindiOrder} का OTP सत्यापित हो गया है और डिलीवरी पूरी हो गई है।${next ? ` अगली डिलीवरी ऑर्डर ${next.order_number}, ${next.customer_name} की है। क्या आप दिशाएँ खोलना चाहेंगे?` : ''}`, responseLanguage, `${order} ka OTP verify ho gaya aur delivery complete hai.${next ? ` Aapki next delivery order ${next.order_number}, ${next.customer_name} ki hai. Kya main directions dikhaun?` : ''}`)
          }
          default: return localizedReply(`The update for ${order} has been recorded.`, `${hindiOrder} के लिए अपडेट दर्ज कर दिया गया है।`, responseLanguage)
        }
      })()
      setLastResponse(actionMessage)
      setVoiceStatus('speaking')
      try {
        if (conversationActive.current) startInterruptRecognition()
        await speak(actionMessage, responseLanguage)
        clearRecognition()
        setVoiceStatus('success')
        if (conversationActive.current) void startCommandRecording()
      } catch (e) {
        clearRecognition()
        if (e instanceof Error && e.name === 'AbortError') return
        setError(`Your update was saved, but ${speechPlaybackError(e).toLowerCase()}`)
        setVoiceStatus('error')
      }
      if (!conversationActive.current && wakeSupported) window.setTimeout(() => startStandbyRecognition(), 350)
    } catch (e) {
      if (actionGeneration !== sessionGeneration.current) return
      setActionFailed(true)
      const detail = e instanceof Error ? e.message : 'Could not save the delivery update'
      const recovery = localizedReply(`I could not record that update: ${detail}. You can retry or use the delivery controls.`, `यह अपडेट दर्ज नहीं हो सका: ${detail}। फिर से कोशिश करें या डिलीवरी के मैनुअल विकल्प इस्तेमाल करें।`, responseLanguage)
      setError(recovery); setLastResponse(recovery); setVoiceStatus('error')
      try {
        if (conversationActive.current) startInterruptRecognition()
        await speak(recovery, responseLanguage)
      } catch { /* Text remains visible when speech playback is unavailable. */ }
      clearRecognition()
      if (conversationActive.current) void startCommandRecording(true)
    } finally {
      actionInFlight.current = false
    }
  }

  const recordManualAction = async (action: string) => {
    navigationOfferStopId.current = null
    if (!current && !(action === 'delivered' && otpStop)) return
    const target = action === 'delivered' && otpStop ? otpStop : current
    if (!target) return
    let otp: string | undefined
    if (action === 'delivered') {
      if (!otpPending) { setOtpStopId(target.id); setSelectedStopId(target.id); setPage('deliveries'); setOtpPending(true); setOtpConfirmed(false); return }
      if (!otpConfirmed || otpEntry.length !== target.otp_length) { setError(`Enter the complete ${target.otp_length}-digit delivery OTP and confirm it before submitting.`); return }
      otp = otpEntry.trim()
    }
    setError('')
    setVoiceStatus('processing')
    try {
      const updated = await applyAction(target.id, action, otp)
      setRun(updated); setVoiceStatus('success')
      if (action === 'delivered') {
        const nextEligible = [...updated.stops].filter((stop) => stop.status === 'pending').sort((left, right) => left.sequence - right.sequence || left.id - right.id)[0]
        setSelectedStopId(nextEligible?.id ?? null); setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false)
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the update'); setVoiceStatus('error') }
  }

  const submitCustomerPhone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!current || !phoneEntry.trim()) return
    try {
      setRun(await saveCustomerPhone(current.id, phoneEntry.trim()))
      setPhoneEntry(''); setPhoneEditorOpen(false); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the customer number') }
  }

  const toggleWake = () => {
    void enableSpeechOutput()
    if (!wakeSupported) { setError('Wake phrase listening is supported in Chrome and some Android browsers. Use the Talk button here.'); return }
    if (conversationActive.current) { stopVoiceSession(); return }
    if (wakeEnabled) { clearRecognition(); setWakeEnabled(false); setVoiceStatus('idle'); return }
    startStandbyRecognition()
  }

  useEffect(() => () => { clearRecognition(); stopSpeaking(); void recorder.current?.cancel() }, [])

  useEffect(() => {
    if (!otpPending || page !== 'deliveries') return
    window.requestAnimationFrame(() => document.getElementById('delivery-otp-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [otpPending, page, selectedStopId])

  if (!welcomeComplete) {
    return <WelcomePage onGetStarted={() => {
      window.localStorage.setItem('sarthi:onboarding-complete', 'true')
      setWelcomeComplete(true)
      setPage('home')
    }} />
  }

  return (
    <main className="app-shell">
      <AppHeader riderName={run?.rider_name ?? 'Rider'} online={run?.status === 'active'} onHome={() => { navigationOfferStopId.current = null; setPage('home'); setSelectedStopId(null) }} />
      {page === 'home' ? <section className="welcome-row">
        <div><p className="eyebrow">TODAY’S RUN</p><h1>Hello, {run?.rider_name ?? 'Rider'}</h1><p className="muted">Your deliveries and rider assistance for this run.</p></div>
        <div className="run-pill"><span className={`online-dot ${run?.status === 'active' ? '' : 'offline'}`} /> {run?.status === 'active' ? 'Active run' : loading ? 'Loading…' : 'Run unavailable'}</div>
      </section> : <section className="page-heading"><div><p className="eyebrow">SARTHI · DELIVERY CO-PILOT</p><h1>{page === 'deliveries' ? 'Your deliveries' : page === 'map' ? 'Navigation' : page === 'sarthi' ? 'Voice assistant' : 'Activity'}</h1></div>{page === 'deliveries' && <span>{stops.length} orders</span>}</section>}
      {error && <div className="error-banner" role="alert"><span>{error}</span>{audioNeedsUnlock && <button className="button button-primary" onClick={() => void enableSpeechOutput()}>{audioReady ? 'Retry audio' : 'Enable audio'}</button>}{/microphone permission|hands-free wake listening could not start/i.test(error) && <button className="button button-primary" onClick={startStandbyRecognition}>Enable hands-free</button>}</div>}
      {page === 'home' && <DeliveryProgress completed={completed} remaining={remaining} total={stops.length} />}
      <section className="content-grid">
        <div className="main-column">
          {(page === 'home' || (page === 'deliveries' && selectedStopId !== null && selectedStop?.status !== 'delivered')) && <ActiveDeliveryCard stop={current} isHome={page === 'home'} isActive={current?.id === activeStop?.id} phoneEntry={phoneEntry} phoneEditorOpen={phoneEditorOpen} voiceLabel={micButtonLabel} voiceDisabled={!canStartVoice && voiceStatus !== 'listening'} showOtpSection={page === 'deliveries'} showOtpForm={page === 'deliveries' && otpPending} otpEntry={otpEntry} otpConfirmed={otpConfirmed} otpBusy={voiceBusy} onOtpEntry={(value) => { setOtpEntry(value); setOtpConfirmed(false) }} onOtpConfirm={setOtpConfirmed} onCancelOtp={() => { navigationOfferStopId.current = null; setOtpPending(false); setOtpStopId(null); setOtpEntry(''); setOtpConfirmed(false) }} onBack={() => { navigationOfferStopId.current = null; setSelectedStopId(null) }} onNavigate={() => { navigationOfferStopId.current = null; if (current) { setSelectedStopId(current.id); setNavigationStartStopId(current.id); setPage('map') } }} onDetails={() => { if (current) { navigationOfferStopId.current = null; setSelectedStopId(current.id); setPage('deliveries') } }} onVoice={() => { setPage('sarthi'); void handleVoice() }} onAction={(action) => void recordManualAction(action)} onPhoneEntry={setPhoneEntry} onPhoneSave={(event) => void submitCustomerPhone(event)} onPhoneEditor={() => setPhoneEditorOpen((open) => !open)} />}
          {page === 'home' && nextStop && <NextDeliveryCard stop={nextStop} onDetails={() => { navigationOfferStopId.current = null; setSelectedStopId(nextStop.id); setPage('deliveries') }} onNavigate={() => { navigationOfferStopId.current = null; setSelectedStopId(nextStop.id); setNavigationStartStopId(nextStop.id); setPage('map') }} />}
          {(transcript || proposal) && <article className="list-card voice-result-card">
            <div className="voice-result-heading"><p className="eyebrow">VOICE UPDATE</p><span className={`voice-status status-${voiceStatus}`} role="status" aria-live="polite">{voiceStatusLabel[voiceStatus]}</span></div>
            {transcript && <div className="heard-text"><span>I heard</span><p className="transcript">“{transcript}”</p></div>}
            {proposal && <><p className="proposal-text">{proposal.response_text}</p>{proposal.proposed_action && <div className="proposed-action"><span>Proposed action</span><strong>{proposal.proposed_action === 'contact_attempt' ? 'Record customer contact attempt' : proposal.proposed_action === 'wrong_address' ? 'Report an address issue' : proposal.proposed_action === 'reschedule' ? 'Record a reschedule request' : proposal.proposed_action === 'delivered' ? 'Verify and complete delivery' : proposal.proposed_action === 'call_customer' ? 'Call the customer' : 'Open directions'}</strong><small>Review the transcript, then confirm to continue.</small></div>}
              {proposal.proposed_action === 'delivered' && otpPending && <button className="button button-light wide" onClick={() => void startCommandRecording()}><Mic size={16} /> Speak OTP or say yes / no</button>}
              <div className="action-row">
                {proposal.proposed_action && <button className="button button-primary" onClick={() => void confirmProposal()} disabled={voiceBusy}>{actionFailed ? 'Retry confirmed action' : proposal.proposed_action === 'contact_attempt' ? 'Confirm contact attempt' : proposal.proposed_action === 'wrong_address' ? 'Confirm address issue' : proposal.proposed_action === 'reschedule' ? 'Confirm time request' : proposal.proposed_action === 'delivered' ? otpPending ? 'Verify OTP and complete' : 'Continue to OTP' : proposal.proposed_action === 'call_customer' ? 'Open customer dialer' : 'Open directions'}</button>}
                <button className="button button-light" onClick={dismissProposal} disabled={voiceBusy}>{proposal.proposed_action ? 'Cancel' : 'Close'}</button>
              </div>
            </>}
            {voiceStatus === 'error' && <div className="voice-retry-row"><span>{error || 'Something went wrong with voice processing.'}</span><button className="button button-light" onClick={retryVoice}>{actionFailed ? 'Retry action' : lastResponse ? 'Repeat response' : transcript ? 'Retry understanding' : 'Try recording again'}</button></div>}
            {lastResponse && voiceStatus !== 'speaking' && voiceStatus !== 'error' && <button className="repeat-response" onClick={() => void repeatResponse()} disabled={voiceBusy}><Volume2 size={15} /> Repeat response</button>}
          </article>}
          {page === 'deliveries' && selectedStopId === null && <DeliveriesPage stops={stops} filter={deliveryFilter} activeStopId={activeStop?.id} selectedStopId={selectedStopId} onFilter={setDeliveryFilter} onSelect={(stop) => { if (otpPending) { setError('Finish or cancel OTP verification before switching deliveries.'); return } navigationOfferStopId.current = null; setSelectedStopId(stop.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}
          {page === 'deliveries' && selectedStop?.status === 'delivered' && <article className="list-card selected-delivery-summary"><div className="section-heading"><button className="back-button" onClick={() => setSelectedStopId(null)} aria-label="Back to deliveries"><ArrowLeft size={19} /></button><div><p className="eyebrow">COMPLETED PARCEL</p><h2>Order #{selectedStop.order_number}</h2></div><span className="status-tag">Delivered</span></div><strong>{selectedStop.customer_name}</strong><p>{selectedStop.parcel_description} · {selectedStop.package_category}{selectedStop.weight_kg ? ` · ${selectedStop.weight_kg.toFixed(1)} kg` : ''}</p><p>{selectedStop.address}</p><p>{selectedStop.access_note || 'No saved access instructions'}</p><span className="payment-pill">{selectedStop.payment_type === 'cod' ? `COD · ₹${selectedStop.cod_amount ?? 0}` : 'Prepaid'}</span><span className="verification-complete"><ShieldCheck size={17} /> Delivery OTP verified</span><small>Completed records are read-only.</small></article>}
          {page === 'map' && <MapPage stop={mapTarget} autoStart={navigationStartStopId === mapTarget?.id} stopSignal={navigationStopVersion} command={navigationCommand} language={responseLanguage} onSnapshot={receiveNavigationSnapshot} onSpeak={(stop) => { void speak(`${stop.address}. ${stop.access_note}`, responseLanguage).catch(() => setError('Could not play voice guidance')) }} onGuidance={(instruction) => void speakNavigationGuidance(instruction)} onNavigationStarted={onNavigationStarted} onNavigationError={onNavigationError} />}
          {page === 'sarthi' && <SarthiPage status={voiceStatus} statusLabel={voiceStatusLabel[voiceStatus]} engine={understandingEngine} wakeEnabled={wakeEnabled} sessionActive={conversationActive.current} wakeSupported={wakeSupported} canStartVoice={canStartVoice} voiceBusy={voiceBusy} micLabel={micButtonLabel} lastResponse={lastResponse} history={history} onMic={() => void handleVoice()} onToggleWake={toggleWake} onRetry={retryVoice} onRepeat={() => void repeatResponse()} />}
          {page === 'activity' && <ActivityPage activities={run?.activities ?? []} />}
        </div>
        <aside className="side-column">
          {page === 'home' && <AssistantShortcut status={voiceStatus} label={voiceStatusLabel[voiceStatus]} busy={voiceBusy} micLabel={micButtonLabel} lastResponse={lastResponse} disabled={!canStartVoice && voiceStatus !== 'listening'} onOpen={() => { setPage('sarthi'); void handleVoice() }} onRepeat={() => void repeatResponse()} onRetry={retryVoice} />}
          {page === 'home' && <article className="timeline-card"><div className="section-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Recent updates</h2></div><button className="text-button" onClick={() => setPage('activity')}>See all</button></div><ActivityTimeline activities={run?.activities ?? []} limit={4} /></article>}
          {page === 'sarthi' && current && <article className="timeline-card manual-fallback"><p className="eyebrow">MANUAL FALLBACK</p><h2>Update without voice</h2><p className="muted">These actions remain available if the microphone or voice services are unavailable.</p><button className="button button-light wide" onClick={() => void recordManualAction('contact_attempt')}>Record contact attempt</button><button className="button button-light wide" onClick={() => void recordManualAction('wrong_address')}>Report address issue</button><button className="button button-light wide" onClick={() => void recordManualAction('reschedule')}>Record time request</button><button className="button button-primary wide" onClick={() => void recordManualAction('delivered')}>Verify delivery with OTP</button></article>}
        </aside>
      </section>
      <BottomNavigation page={page} onNavigate={setPage} />
      <footer>Voice-first delivery support · Use voice controls only when it is safe</footer>
    </main>
  )
}
