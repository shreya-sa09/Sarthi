import { ChevronRight, MapPin, Package } from 'lucide-react'
import type { Stop } from '../../api'
import { DeliveryStatusBadge, PaymentBadge } from './DeliveryBadges'

export function DeliveryCard({ stop, selected, onSelect }: { stop: Stop; selected: boolean; onSelect: (stop: Stop) => void }) {
  return <button type="button" className={`delivery-card ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(stop)}>
    <div className="delivery-card-top"><span className="order-number">Order #{stop.order_number}</span><DeliveryStatusBadge status={stop.status} /></div>
    <strong className="delivery-customer">{stop.customer_name}</strong>
    <span className="delivery-address"><MapPin size={15} />{stop.address}</span>
    <span className="delivery-parcel"><Package size={15} />{stop.parcel_description || 'Parcel'} · {stop.package_category || 'Package'}</span>
    <div className="delivery-card-bottom"><PaymentBadge paymentType={stop.payment_type} amount={stop.cod_amount} /><span className="delivery-open">Details <ChevronRight size={16} /></span></div>
  </button>
}
