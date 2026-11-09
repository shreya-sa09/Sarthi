import { Sparkles } from 'lucide-react'

export function AppHeader({ riderName, demo, online, onHome }: { riderName: string; demo: boolean; online: boolean; onHome: () => void }) {
  return <header className="topbar">
    <button className="brand brand-button" type="button" onClick={onHome} aria-label="Go to Home"><span className="brand-mark"><Sparkles size={17} /></span><span>Sarthi</span></button>
    <div className="rider"><span className={`online-dot ${online ? '' : 'offline'}`} />{online ? 'On shift' : 'Offline'}<span className="avatar" aria-hidden="true">{riderName.slice(0, 1).toUpperCase()}</span></div>
    {demo && <span className="demo-header-badge">Demo run</span>}
  </header>
}
