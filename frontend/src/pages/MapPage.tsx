import { MapPin, Volume2 } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { Stop } from '../api'
import type { NavigationCommand, NavigationSnapshot } from '../components/map/DeliveryNavigationMap'

const DeliveryNavigationMap = lazy(() => import('../components/map/DeliveryNavigationMap').then((module) => ({ default: module.DeliveryNavigationMap })))

export function MapPage({ stop, autoStart, stopSignal, command, language, onSnapshot, onSpeak, onGuidance, onNavigationStarted, onNavigationError }: {
  stop: Stop | null
  autoStart: boolean
  stopSignal: number
  command: NavigationCommand
  language: string
  onSnapshot: (snapshot: NavigationSnapshot) => void
  onSpeak: (stop: Stop) => void
  onGuidance: (instruction: string) => void
  onNavigationStarted: (instruction: string, metersRemaining: number | null) => void
  onNavigationError: (message: string) => void
}) {
  if (!stop) return <article className="list-card map-page"><div className="section-heading"><div><p className="eyebrow">DELIVERY DESTINATION</p><h2>No active stop</h2></div></div><p className="muted">All stops are complete. Select another delivery to see its destination.</p></article>

  return <div className="map-page">
    <article className="list-card map-destination-card">
      <div className="section-heading"><div><p className="eyebrow">SELECTED DESTINATION</p><h2>Order #{stop.order_number}</h2></div><span className="status-tag">{stop.status === 'delivered' ? 'Delivered' : stop.status}</span></div>
      <p className="map-address"><MapPin size={17} />{stop.address}</p>
      <p className="map-help"><strong>{stop.customer_name}</strong> · {stop.access_note || 'No saved access instructions'}</p>
      <div className="map-page-actions"><button className="button button-light" onClick={() => onSpeak(stop)}><Volume2 size={17} />Read address</button></div>
    </article>
    <Suspense fallback={<div className="navigation-map-loading" role="status">Loading the interactive map…</div>}>
      <DeliveryNavigationMap stop={stop} autoStart={autoStart} stopSignal={stopSignal} command={command} language={language} onSnapshot={onSnapshot} onGuidance={onGuidance} onNavigationStarted={onNavigationStarted} onNavigationError={onNavigationError} />
    </Suspense>
  </div>
}
