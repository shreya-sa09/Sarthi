import type { Stop } from '../api'
import { DeliveryCard } from '../components/delivery/DeliveryCard'

export type DeliveryFilter = 'all' | 'pending' | 'active' | 'completed' | 'exceptions'
const filters: Array<[DeliveryFilter, string]> = [['all', 'All'], ['active', 'Active'], ['pending', 'Pending'], ['completed', 'Completed'], ['exceptions', 'Exceptions']]

export function DeliveriesPage({ stops, filter, activeStopId, selectedStopId, onFilter, onSelect }: {
  stops: Stop[]
  filter: DeliveryFilter
  activeStopId?: number
  selectedStopId: number | null
  onFilter: (filter: DeliveryFilter) => void
  onSelect: (stop: Stop) => void
}) {
  const visible = stops.filter((stop) => filter === 'all'
    || (filter === 'active' && stop.id === activeStopId)
    || (filter === 'pending' && stop.status === 'pending' && stop.id !== activeStopId)
    || (filter === 'completed' && stop.status === 'delivered')
    || (filter === 'exceptions' && stop.status === 'exception'))
  return <article className="list-card delivery-queue"><div className="section-heading"><div><p className="eyebrow">DELIVERY QUEUE</p><h2>Deliveries</h2></div><span className="count-label">{stops.length} orders</span></div>
    <div className="delivery-filter-row" role="group" aria-label="Filter deliveries">{filters.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => onFilter(value)}>{label}{value === 'all' ? ` · ${stops.length}` : ''}</button>)}</div>
    {visible.length ? <div className="delivery-card-list">{visible.map((stop) => <DeliveryCard key={stop.id} stop={stop} selected={selectedStopId === stop.id} onSelect={onSelect} />)}</div> : <p className="empty-state">No deliveries in this group.</p>}
  </article>
}
