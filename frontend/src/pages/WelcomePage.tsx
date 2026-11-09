import { ArrowRight, MapPin } from 'lucide-react'

export function WelcomePage({ onGetStarted }: { onGetStarted: () => void }) {
  return <main className="welcome-screen">
    <div className="welcome-top"><span className="welcome-brand-mark"><MapPin size={24} fill="currentColor" /></span><span>Sarthi</span></div>
    <section className="welcome-copy">
      <p className="eyebrow">YOUR DELIVERY CO-PILOT</p>
      <h1>Every delivery.<br />One voice. Zero confusion.</h1>
      <p>Clear directions and delivery support, right when you need them.</p>
    </section>
    <div className="welcome-illustration-wrap">
      <svg className="welcome-illustration" viewBox="0 0 420 330" role="img" aria-label="Illustration of a delivery rider on a scooter">
        <defs>
          <linearGradient id="scooterBody" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#8955E8"/><stop offset="1" stopColor="#5125AA"/></linearGradient>
          <linearGradient id="parcelBody" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#7E50D5"/><stop offset="1" stopColor="#48228E"/></linearGradient>
        </defs>
        <path d="M18 272h384" stroke="#d5c9ef" strokeWidth="2" strokeLinecap="round"/>
        <path d="M27 264c20-25 36-25 55 0 14-18 30-22 47 0 14-30 42-34 60 0 19-21 38-23 56 0 17-28 45-30 63 0 22-23 40-23 65 0" fill="#e6def6"/>
        <path d="M26 232h20v32H26zm24-18h26v50H50zm30 12h18v38H80zm226-31h22v69h-22zm27 16h25v53h-25zm31-29h26v82h-26z" fill="#d8cdec" opacity=".85"/>
        <circle cx="113" cy="246" r="33" fill="#30224f"/><circle cx="113" cy="246" r="19" fill="#f8f5fc"/><circle cx="113" cy="246" r="9" fill="#b8a5d7"/>
        <circle cx="297" cy="246" r="33" fill="#30224f"/><circle cx="297" cy="246" r="19" fill="#f8f5fc"/><circle cx="297" cy="246" r="9" fill="#b8a5d7"/>
        <path d="M92 224c13-22 35-33 65-34l45 2 31-15 20 11-15 20c-3 20-16 35-39 40h-36l-21-22h-31l-19 17-18-4z" fill="url(#scooterBody)" stroke="#382061" strokeWidth="4" strokeLinejoin="round"/>
        <path d="m229 179 20-24 19 4 15 28-19 12-19-11" fill="#33214f" stroke="#382061" strokeWidth="4" strokeLinejoin="round"/>
        <path d="m246 155 18-3 8 8-18 9" fill="#f5d46f"/>
        <path d="m160 188 18-35 39-14 16 12-16 14-23 13 16 20" fill="#28213d" stroke="#382061" strokeWidth="4" strokeLinejoin="round"/>
        <path d="m178 157 16-34 18-3 12 14-10 15-21 14" fill="#f0c39b"/>
        <path d="m184 127 4-18c3-13 16-20 29-16 12 4 18 18 12 30l-6 12-19 5z" fill="#4d2a85" stroke="#382061" strokeWidth="4"/>
        <path d="m188 117 3-11c6-11 20-15 30-8 5 3 8 8 9 13-11-4-23-2-34 6z" fill="#7a4bc6"/>
        <path d="m176 158-17 31 22 8 18-22" fill="#f0c39b"/>
        <path d="M91 177h47v45H91z" fill="url(#parcelBody)" stroke="#382061" strokeWidth="4" strokeLinejoin="round"/>
        <path d="M111 178v44m-20-25h47" stroke="#c9b5ee" strokeWidth="3"/>
        <path d="m111 191 7 4-7 8-7-8z" fill="#fff"/>
        <path d="m148 188 13-5 15 8-8 15-19-3" fill="#4d2a85"/>
        <path d="M115 278h210" stroke="#c6b8df" strokeWidth="2" strokeDasharray="6 9"/>
      </svg>
    </div>
    <div className="welcome-bottom"><span>Voice-first support for every stop</span><button className="button button-primary welcome-start" onClick={onGetStarted}>Get Started <ArrowRight size={18} /></button></div>
  </main>
}
