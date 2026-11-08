from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.database import Base, SessionLocal, engine
from app.evon import router as evon_router
from app.models import Activity, DeliveryRun, DeliveryStop
from app.settings import settings
from app.voice import router as voice_router

app = FastAPI(title="Sarthi API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(router)
app.include_router(voice_router)
app.include_router(evon_router)


@app.on_event("startup")
def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.query(DeliveryRun).first() is not None:
            return
        run = DeliveryRun(rider_name="Arjun", status="active")
        db.add(run)
        db.flush()
        run.stops = [
            DeliveryStop(sequence=1, order_number="1042", customer_name="Rahul Sharma", customer_phone="", address="Shree Residency, Baner, Pune", access_note="Gate 2 · Tower B", status="pending", otp_code="48291"),
            DeliveryStop(sequence=2, order_number="1043", customer_name="Ananya Kulkarni", customer_phone="", address="Aundh Road, Pune", access_note="Call on arrival", status="pending", otp_code="56124"),
            DeliveryStop(sequence=3, order_number="1044", customer_name="Vikram Patil", customer_phone="", address="University Circle, Pune", access_note="Leave with reception", status="pending", otp_code="77321"),
        ]
        db.add(Activity(run=run, event_type="run_started", summary="Delivery run started"))
        db.commit()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "sarthi-api"}
