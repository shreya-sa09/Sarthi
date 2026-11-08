from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DeliveryRun(Base):
    __tablename__ = "delivery_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    rider_name: Mapped[str] = mapped_column(String(120), default="Arjun")
    status: Mapped[str] = mapped_column(String(20), default="active")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    stops: Mapped[list["DeliveryStop"]] = relationship(back_populates="run", cascade="all, delete-orphan", order_by="DeliveryStop.sequence")
    activities: Mapped[list["Activity"]] = relationship(back_populates="run", cascade="all, delete-orphan", order_by="Activity.created_at")


class DeliveryStop(Base):
    __tablename__ = "delivery_stops"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("delivery_runs.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    order_number: Mapped[str] = mapped_column(String(32))
    customer_name: Mapped[str] = mapped_column(String(120))
    customer_phone: Mapped[str] = mapped_column(String(32), default="")
    address: Mapped[str] = mapped_column(String(300))
    access_note: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    exception_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
    otp_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    run: Mapped[DeliveryRun] = relationship(back_populates="stops")


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("delivery_runs.id", ondelete="CASCADE"), index=True)
    stop_id: Mapped[int | None] = mapped_column(ForeignKey("delivery_stops.id", ondelete="SET NULL"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(48))
    summary: Mapped[str] = mapped_column(String(300))
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    run: Mapped[DeliveryRun] = relationship(back_populates="activities")
