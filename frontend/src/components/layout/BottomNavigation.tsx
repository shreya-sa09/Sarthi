import { Activity, Home, List, Map, Mic } from 'lucide-react'

export type AppPage = 'home' | 'deliveries' | 'map' | 'sarthi' | 'activity'

const items = [
  ['home', Home, 'Home'], ['deliveries', List, 'Deliveries'], ['map', Map, 'Map'],
  ['sarthi', Mic, 'Sarthi'], ['activity', Activity, 'Activity'],
] as const

export function BottomNavigation({ page, onNavigate }: { page: AppPage; onNavigate: (page: AppPage) => void }) {
  return <nav className="app-nav" aria-label="Rider pages">
    {items.map(([id, Icon, label]) => <button type="button" key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => onNavigate(id)}><Icon size={20} strokeWidth={1.9} /><span>{label}</span></button>)}
  </nav>
}
