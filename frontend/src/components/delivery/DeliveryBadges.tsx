import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react'

export function DeliveryStatusBadge({ status }: { status: string }) {
  const label = status === 'delivered' ? 'Completed' : status === 'exception' ? 'Exception' : status === 'active' ? 'Active' : 'Pending'
  const Icon = status === 'delivered' ? CheckCircle2 : status === 'exception' ? AlertCircle : Clock3
  return <span className={`delivery-status status-${status}`}><Icon size={14} />{label}</span>
}

export function PaymentBadge({ paymentType, amount }: { paymentType: string; amount?: number | null }) {
  return <span className={`payment-badge ${paymentType === 'cod' ? 'payment-cod' : 'payment-prepaid'}`}>{paymentType === 'cod' ? `COD${amount != null ? ` · ₹${amount}` : ''}` : 'Prepaid'}</span>
}
