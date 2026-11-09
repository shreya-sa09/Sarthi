import { CheckCircle2, Package, Route } from 'lucide-react'

export function DeliveryProgress({ completed, remaining, total }: { completed: number; remaining: number; total: number }) {
  const progress = total ? Math.round((completed / total) * 100) : 0
  return <section className="progress-card" aria-label="Delivery progress">
    <div className="progress-card-heading"><div><span className="eyebrow">TODAY’S RUN</span><strong>Delivery progress</strong></div><span className="progress-fraction">{progress}%</span></div>
    <div className="progress-metrics">
      <div><Package size={17} /><strong>{total}</strong><span>Total</span></div>
      <div><CheckCircle2 size={17} /><strong>{completed}</strong><span>Completed</span></div>
      <div><Route size={17} /><strong>{remaining}</strong><span>Remaining</span></div>
    </div>
    <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={completed}><span style={{ width: `${progress}%` }} /></div>
  </section>
}
