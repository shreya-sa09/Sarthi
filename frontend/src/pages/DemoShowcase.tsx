import { useState } from 'react'
import { ArrowUpRight, Check, Headphones, MapPinned, Mic2, PackageCheck, PhoneCall, Route } from 'lucide-react'

const steps = [
  { title: 'Navigate by voice', detail: 'Get the next turn spoken aloud.', icon: Route },
  { title: 'Handle an exception', detail: 'Explain the issue naturally in Hinglish.', icon: Mic2 },
  { title: 'Reach the customer', detail: 'Confirm and open the simulated call.', icon: PhoneCall },
  { title: 'Verify the delivery', detail: 'Enter the OTP before marking it done.', icon: PackageCheck },
  { title: 'Keep the run moving', detail: 'See progress and a clear activity trail.', icon: Check },
]

export function DemoShowcase() {
  const [activeStep, setActiveStep] = useState(0)

  return <main className="demo-showcase">
    <div className="showcase-grain" aria-hidden="true" />
    <header className="showcase-header">
      <a href="/" className="showcase-brand" aria-label="Sarthi home"><span className="showcase-brand-mark"><Headphones size={19} /></span><span>SARTHI</span></a>
      <div className="showcase-live"><i /> LIVE PRODUCT DEMO</div>
    </header>

    <section className="showcase-layout">
      <div className="showcase-copy">
        <p className="showcase-kicker"><span>VOICE-FIRST DELIVERY CO-PILOT</span><b>01 — 05</b></p>
        <h1>Every stop has<br /><em>a next step.</em></h1>
        <p className="showcase-description">Sarthi helps delivery riders navigate, handle problems, contact customers, and verify each handoff—using their voice.</p>

        <div className="showcase-steps" aria-label="Demo chapters">
          {steps.map((step, index) => {
            const Icon = step.icon
            const selected = activeStep === index
            const complete = index < activeStep
            return <button key={step.title} type="button" className={`showcase-step ${selected ? 'is-current' : ''} ${complete ? 'is-complete' : ''}`} onClick={() => setActiveStep(index)} aria-current={selected ? 'step' : undefined}>
              <span className="showcase-step-number">{complete ? <Check size={16} /> : String(index + 1).padStart(2, '0')}</span>
              <span className="showcase-step-copy"><strong>{step.title}</strong><small>{step.detail}</small></span>
              <Icon className="showcase-step-icon" size={19} />
              <span className="showcase-step-progress" />
            </button>
          })}
        </div>

        <div className="showcase-tech-row"><span><i className="tech-dot prisma" /> PRISMA · SPEECH</span><span><i className="tech-dot timbre" /> TIMBRE · VOICE</span></div>
        <p className="showcase-safety">Voice guidance is for use when it is safe to interact.</p>
      </div>

      <div className="showcase-device-stage">
        <div className="showcase-orbit orbit-one" aria-hidden="true" />
        <div className="showcase-orbit orbit-two" aria-hidden="true" />
        <div className="showcase-location-chip"><MapPinned size={15} /> PUNE DEMO ROUTE <span>·</span> LIVE APP</div>
        <div className="showcase-phone-shadow" aria-hidden="true" />
        <div className="showcase-phone">
          <div className="showcase-phone-side" aria-hidden="true" />
          <div className="showcase-phone-screen">
            <div className="showcase-phone-island" aria-hidden="true"><span /></div>
            <iframe title="Live Sarthi mobile app" src="/" allow="microphone; autoplay; geolocation" />
          </div>
        </div>
        <div className="showcase-phone-caption"><span className="caption-live-dot" /> REAL APP · MOBILE LAYOUT <ArrowUpRight size={15} /></div>
      </div>
    </section>
    <footer className="showcase-footer"><span>THE RIDER’S NEXT STEP, SPOKEN.</span><span>INDIA · 2026</span></footer>
  </main>
}
