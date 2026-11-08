from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Activity, DeliveryRun, DeliveryStop, utcnow
from app.schemas import RunView, StopAction, StopContact

router = APIRouter(prefix="/api")

ACTION_TEXT = {
    "contact_attempt": ("contact_attempt", "Customer contact attempt recorded"),
    "wrong_address": ("wrong_address", "Address issue recorded for resolution"),
    "reschedule": ("reschedule_requested", "Customer requested a different delivery time"),
    "delivered": ("delivered", "Delivery verified and completed"),
}


def get_active_run(db: Session) -> DeliveryRun:
    run = db.scalar(
        select(DeliveryRun)
        .where(DeliveryRun.status == "active")
        .options(selectinload(DeliveryRun.stops), selectinload(DeliveryRun.activities))
        .order_by(DeliveryRun.id.desc())
    )
    if run is None:
        raise HTTPException(status_code=404, detail="No active delivery run")
    return run


@router.get("/run/active", response_model=RunView)
def active_run(db: Session = Depends(get_db)) -> DeliveryRun:
    return get_active_run(db)


@router.patch("/stops/{stop_id}/contact", response_model=RunView)
def save_stop_contact(stop_id: int, body: StopContact, db: Session = Depends(get_db)) -> DeliveryRun:
    run = get_active_run(db)
    stop = db.scalar(select(DeliveryStop).where(DeliveryStop.id == stop_id, DeliveryStop.run_id == run.id))
    if stop is None:
        raise HTTPException(status_code=404, detail="Stop not found in the active run")
    stop.customer_phone = body.phone.strip()
    db.add(Activity(run_id=run.id, stop_id=stop.id, event_type="contact_saved", summary="Customer contact number saved"))
    db.commit()
    db.expire_all()
    return get_active_run(db)


@router.post("/stops/{stop_id}/actions", response_model=RunView)
def apply_stop_action(stop_id: int, body: StopAction, db: Session = Depends(get_db)) -> DeliveryRun:
    run = get_active_run(db)
    stop = db.scalar(select(DeliveryStop).where(DeliveryStop.id == stop_id, DeliveryStop.run_id == run.id))
    if stop is None:
        raise HTTPException(status_code=404, detail="Stop not found in the active run")
    if stop.status == "delivered":
        raise HTTPException(status_code=409, detail="This stop is already complete")
    if body.action == "delivered":
        if not stop.otp_code:
            raise HTTPException(status_code=409, detail="This stop has no configured verification code")
        if not body.otp or body.otp != stop.otp_code:
            raise HTTPException(status_code=422, detail="The delivery code did not match")
        stop.status = "delivered"
        stop.exception_reason = None
    else:
        stop.status = "exception"
        stop.exception_reason = body.action
        stop.sequence = max((item.sequence for item in run.stops), default=stop.sequence) + 1

    event_type, summary = ACTION_TEXT[body.action]
    db.add(Activity(run_id=run.id, stop_id=stop.id, event_type=event_type, summary=summary, transcript=body.transcript, created_at=utcnow()))
    db.commit()
    db.expire_all()
    return get_active_run(db)
