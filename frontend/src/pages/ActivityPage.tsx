import type { Activity } from '../api'
import { ActivityTimeline } from '../components/activity/ActivityTimeline'

export function ActivityPage({ activities }: { activities: Activity[] }) {
  return <article className="timeline-card"><div className="section-heading"><div><p className="eyebrow">PERSISTED EVENTS</p><h2>Run timeline</h2></div></div><ActivityTimeline activities={activities} /></article>
}
