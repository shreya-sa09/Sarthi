from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StopView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sequence: int
    order_number: str
    customer_name: str
    customer_phone: str
    address: str
    access_note: str
    parcel_description: str
    package_category: str
    weight_kg: float | None
    payment_type: str
    cod_amount: int | None
    delivery_window: str | None
    status: str
    exception_reason: str | None
    otp_length: int


class ActivityView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    stop_id: int | None
    event_type: str
    summary: str
    transcript: str | None
    created_at: datetime


class RunView(BaseModel):
    id: int
    rider_name: str
    status: str
    started_at: datetime
    stops: list[StopView]
    activities: list[ActivityView]


class StopAction(BaseModel):
    action: Literal["contact_attempt", "wrong_address", "reschedule", "delivered"]
    transcript: str | None = Field(default=None, max_length=1000)
    otp: str | None = Field(default=None, max_length=12)


class StopContact(BaseModel):
    phone: str = Field(min_length=7, max_length=20, pattern=r"^[+0-9() .-]+$")
