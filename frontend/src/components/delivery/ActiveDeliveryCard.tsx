import type { FormEvent } from 'react'
import { ArrowLeft, MapPin, Mic, Navigation, Package, Pencil, Phone } from 'lucide-react'
import type { Stop } from '../../api'
import { DeliveryStatusBadge, PaymentBadge } from './DeliveryBadges'

function ParcelIllustration() {
  return <div className="parcel-detail-art" aria-hidden="true"><svg viewBox="0 0 120 100"><path d="M13 31 59 8l48 22-47 25L13 31Z" fill="#f2c997"/><path d="M13 31v45l47 19V55L13 31Z" fill="#dcaa73"/><path d="M60 55v40l47-22V30L60 55Z" fill="#c98d58"/><path d="m59 8 1 47 47-25L59 8Z" fill="#e8b981"/><path d="m37 19 46 22v16L37 35V19Z" fill="#fff0d9" opacity=".9"/><path d="M51 13v29" stroke="#cf985f" strokeWidth="2"/><path d="m27 39 16 8v14l-16-7V39Zm57-5 11-6v17l-11 6V34Z" fill="#f7dfbd" opacity=".9"/></svg></div>
}

export function ActiveDeliveryCard({ stop, isHome, isActive, isDemo, phoneEntry, phoneEditorOpen, voiceLabel, voiceDisabled, showOtpSection, showOtpForm, otpEntry, otpConfirmed, otpBusy, onBack, onNavigate, onDetails, onVoice, onAction, onOtpEntry, onOtpConfirm, onCancelOtp, onPhoneEntry, onPhoneSave, onPhoneEditor, onDemoCall }: {
  stop: Stop | null
  isHome: boolean
  isActive: boolean
  isDemo: boolean
  phoneEntry: string
  phoneEditorOpen: boolean
  showOtpForm: boolean
  otpEntry: string
  otpConfirmed: boolean
  otpBusy: boolean
  voiceLabel: string
  voiceDisabled: boolean
  showOtpSection: boolean
  onBack: () => void
  onNavigate: () => void
  onDetails: () => void
  onVoice: () => void
  onAction: (action: string) => void
  onOtpEntry: (value: string) => void
  onOtpConfirm: (confirmed: boolean) => void
  onCancelOtp: () => void
  onPhoneEntry: (value: string) => void
  onPhoneSave: (event: FormEvent<HTMLFormElement>) => void
  onPhoneEditor: () => void
  onDemoCall: () => void
}) {
  return <article className={`current-card ${isHome ? 'home-delivery-card' : 'delivery-detail-card'}`}><div className="section-heading">{!isHome && <button className="back-button" onClick={onBack} aria-label="Back to deliveries"><ArrowLeft size={19} /></button>}<div><p className="eyebrow">{isHome ? 'ACTIVE DELIVERY' : 'DELIVERY DETAILS'}</p><h2>{stop ? `Order #${stop.order_number}` : 'No active delivery'}</h2></div>{stop && <DeliveryStatusBadge status={stop.status === 'pending' && isActive ? 'active' : stop.status} />}</div>
    {stop && <>{!isHome && <ParcelIllustration />}<div className="customer-row"><div className="customer-avatar" aria-hidden="true">{stop.customer_name[0]}</div><div className="customer-info"><strong>{stop.customer_name}</strong><span>{isHome ? 'Delivery verification required' : 'Customer'}</span></div>{stop.customer_phone ? <><a className="icon-button" aria-label={`Call ${stop.customer_name}`} href={`tel:${stop.customer_phone}`}><Phone size={18} /></a><button className="icon-button" aria-label="Change saved customer phone number" onClick={onPhoneEditor}><Pencil size={17} /></button></> : <button className="icon-button" aria-label="Add customer phone number" onClick={onPhoneEditor}><Phone size={18} /></button>}</div>
      {phoneEditorOpen && <form className="phone-editor" onSubmit={onPhoneSave}><label htmlFor="customer-phone">{stop.customer_phone ? 'Replace customer phone number' : 'Customer phone number'}</label><div><input id="customer-phone" type="tel" autoComplete="tel" value={phoneEntry} onChange={(event) => onPhoneEntry(event.target.value)} placeholder="Enter number privately" required minLength={7} maxLength={20}/><button className="button button-primary" type="submit">Save number</button></div><small>Saved to this delivery’s local contact record.</small></form>}
      <div className="address-box"><MapPin size={19} /><div><strong>{stop.address}</strong>{isHome && <span>{stop.access_note || 'No access notes'}</span>}</div></div>
      {!isHome && <div className="instructions-box"><span>DELIVERY INSTRUCTIONS</span><strong>{stop.access_note || 'No special access instructions saved.'}</strong></div>}
      <div className="parcel-info-card"><div className="parcel-illustration"><Package size={23} /></div><div className="parcel-info-copy"><span>PARCEL · {stop.package_category || 'Package'}</span><strong>{stop.parcel_description || 'Delivery parcel'}</strong><small>{stop.weight_kg ? `${stop.weight_kg.toFixed(1)} kg · ` : ''}Order #{stop.order_number}</small></div><PaymentBadge paymentType={stop.payment_type} amount={stop.cod_amount} /></div>
      <div className="delivery-meta-grid">{stop.delivery_window && <div><span>Delivery window</span><strong>{stop.delivery_window}</strong></div>}<div><span>Payment</span><strong>{stop.payment_type === 'cod' ? `COD · ₹${stop.cod_amount ?? 0}` : 'Prepaid · paid online'}</strong></div><div><span>Verification</span><strong>OTP required · code hidden</strong></div><div><span>Status</span><strong>{stop.status === 'exception' ? 'Needs follow-up' : isActive ? 'Active delivery' : stop.status}</strong></div></div>
      {showOtpSection && !isHome && stop.status !== 'delivered' && <section className="otp-detail-panel" id="delivery-otp-section"><div><span className="otp-lock-icon">OTP</span><div><strong>OTP verification</strong><small>{showOtpForm ? `Order #${stop.order_number} · enter ${stop.otp_length} digits` : 'Required to complete this delivery.'}</small></div></div>{showOtpForm ? <form className="otp-detail-form" onSubmit={(event) => { event.preventDefault(); onAction('delivered') }}><input aria-label="Delivery OTP" inputMode="numeric" autoComplete="one-time-code" maxLength={stop.otp_length || 12} value={otpEntry} onChange={(event) => onOtpEntry(event.target.value.replace(/\D/g, '').slice(0, stop.otp_length || 12))} placeholder="Enter OTP" required />{otpEntry && <small className="otp-digits-readback">Digits entered: {otpEntry}</small>}<label className="otp-confirm"><input type="checkbox" checked={otpConfirmed} onChange={(event) => onOtpConfirm(event.target.checked)} /> I have verified the OTP digits</label><button className="button button-primary" type="submit" disabled={otpEntry.length !== stop.otp_length || !otpConfirmed || otpBusy}>Verify OTP and complete</button><button className="text-button" type="button" onClick={onCancelOtp}>Cancel entry</button></form> : <button className="button button-light otp-start-button" type="button" onClick={() => onAction('delivered')}>Enter delivery OTP</button>}</section>}
      <div className="action-row"><button className="button button-primary" onClick={onNavigate}><Navigation size={17} /> Navigate</button>{stop.customer_phone && <a className="button button-light" href={`tel:${stop.customer_phone}`}><Phone size={17} /> Call customer</a>}{!isHome && isDemo && <button className="button button-light" onClick={onDemoCall}>Demo call</button>}{isHome && <button className="button button-light" onClick={onDetails}>View details</button>}{!isHome && <button className="button button-light" onClick={onVoice} disabled={voiceDisabled}><Mic size={17} /> {voiceLabel}</button>}</div>
      {!isHome && stop.status !== 'delivered' && <div className="manual-actions"><span>Manual delivery actions</span><button onClick={() => onAction('contact_attempt')}>Customer unreachable</button><button onClick={() => onAction('wrong_address')}>Address issue</button><button onClick={() => onAction('reschedule')}>Request reschedule</button></div>}
    </>}
  </article>
}
