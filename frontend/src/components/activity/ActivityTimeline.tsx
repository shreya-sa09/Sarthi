import { Activity as ActivityIcon, AlertCircle, CheckCircle2, Phone, ShieldCheck } from 'lucide-react'
import type { Activity } from '../../api'

function eventIcon(type: string) {
  if (type.includes('delivered') || type.includes('complete')) return CheckCircle2
  if (type.includes('otp')) return ShieldCheck
  if (type.includes('contact') || type.includes('phone')) return Phone
  if (type.includes('exception') || type.includes('address') || type.includes('reschedule')) return AlertCircle
  return ActivityIcon
}

export function ActivityTimeline({ activities, limit }: { activities: Activity[]; limit?: number }) {
  const rows = [...activities].reverse().slice(0, limit)
  if (!rows.length) return <p className="empty-state">No delivery activity has been recorded yet.</p>
  return <div className="activity-timeline">{rows.map((item) => {
    const Icon = eventIcon(item.event_type)
    return <article className="activity-entry" key={item.id}><span className="activity-icon"><Icon size={17} strokeWidth={1.9} /></span><div className="activity-copy"><strong>{item.summary}</strong><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>{item.transcript && <p>“{item.transcript}”</p>}</div></article>
  })}</div>
}
