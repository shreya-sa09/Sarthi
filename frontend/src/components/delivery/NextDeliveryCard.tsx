import { List, MapPin, Navigation, Package } from 'lucide-react'
import type { Stop } from '../../api'
import { PaymentBadge } from './DeliveryBadges'

export function NextDeliveryCard({ stop, onDetails, onNavigate }: { stop: Stop; onDetails: () => void; onNavigate: () => void }) {
  return <article className="list-card next-delivery-card"><div className="section-heading"><div><p className="eyebrow">NEXT DELIVERY</p><h2>Order #{stop.order_number}</h2></div><span className="count-label">Pending</span></div><strong className="next-customer">{stop.customer_name}</strong><p className="next-address"><MapPin size={14} />{stop.address}</p><div className="next-parcel"><Package size={15} />{stop.parcel_description}</div><div className="action-row"><PaymentBadge paymentType={stop.payment_type} amount={stop.cod_amount}/><button className="button button-light" onClick={onDetails}><List size={15} /> Details</button><button className="button button-primary" onClick={onNavigate}><Navigation size={15} /> Navigate</button></div></article>
}
