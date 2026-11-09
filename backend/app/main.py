from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, select, text

from app.api import router
from app.database import Base, SessionLocal, engine
from app.evon import router as evon_router
from app.models import Activity, DeliveryRun, DeliveryStop
from app.navigation import router as navigation_router
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
app.include_router(navigation_router)


DEMO_OTP = "4821"
DEMO_STOPS = [
    {"sequence": 1, "order_number": "1042", "customer_name": "Rahul Sharma", "customer_phone": "+1 202-555-0142", "address": "Shree Residency, Baner Road, Baner, Pune 411045", "access_note": "Gate 2 · Tower B · Ring bell twice", "parcel_description": "Wireless earbuds", "package_category": "Electronics accessory", "weight_kg": 0.35, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "10:00 AM–12:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 2, "order_number": "1043", "customer_name": "Ananya Patil", "customer_phone": "+1 202-555-0143", "address": "Maple Heights, Aundh Road, Aundh, Pune 411007", "access_note": "Use C Wing entrance · Call on arrival", "parcel_description": "Cotton kurta set", "package_category": "Clothing", "weight_kg": 0.8, "payment_type": "cod", "cod_amount": 1299, "delivery_window": "12:00 PM–2:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 3, "order_number": "1044", "customer_name": "Arjun Mehta", "customer_phone": "+1 202-555-0144", "address": "21 Prabhat Road, Deccan Gymkhana, Pune 411004", "access_note": "Flat 3B · Leave with reception if unavailable", "parcel_description": "Contemporary fiction book set", "package_category": "Books", "weight_kg": 1.2, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "2:00 PM–4:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 4, "order_number": "1045", "customer_name": "Neha Kulkarni", "customer_phone": "+1 202-555-0145", "address": "Orchid Enclave, Wakad, Pune 411057", "access_note": "Building A · Security desk will direct you", "parcel_description": "Kitchen storage containers", "package_category": "Household", "weight_kg": 2.4, "payment_type": "cod", "cod_amount": 899, "delivery_window": "3:00 PM–5:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 5, "order_number": "1046", "customer_name": "Rohan Deshmukh", "customer_phone": "+1 202-555-0146", "address": "Riverstone Apartments, Kharadi, Pune 411014", "access_note": "Tower 4 · Reception desk", "parcel_description": "Organic pantry essentials", "package_category": "Grocery", "weight_kg": 3.1, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "9:00 AM–11:00 AM", "status": "delivered", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 6, "order_number": "1047", "customer_name": "Priya Joshi", "customer_phone": "+1 202-555-0147", "address": "16 Lane 5, Koregaon Park, Pune 411001", "access_note": "House 16 · Leave at main desk", "parcel_description": "Skin care gift box", "package_category": "Personal care", "weight_kg": 0.6, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "9:00 AM–11:00 AM", "status": "delivered", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 7, "order_number": "1048", "customer_name": "Isha Shah", "customer_phone": "+1 202-555-0148", "address": "Sapphire Residency, Bavdhan, Pune 411021", "access_note": "Customer reports map pin at adjacent building", "parcel_description": "Ceramic tea set", "package_category": "Home & kitchen", "weight_kg": 1.7, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "4:00 PM–6:00 PM", "status": "exception", "exception_reason": "wrong_address", "otp_code": DEMO_OTP},
    {"sequence": 8, "order_number": "1049", "customer_name": "Mira Deshpande", "customer_phone": "+1 202-555-0149", "address": "Aster Park, Balewadi High Street, Balewadi, Pune 411045", "access_note": "Building 2 · Flat 604 · Use the north lobby", "parcel_description": "Bluetooth keyboard and mouse", "package_category": "Electronics accessory", "weight_kg": 0.9, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "10:30 AM–12:30 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 9, "order_number": "1050", "customer_name": "Kabir Nair", "customer_phone": "+1 202-555-0150", "address": "Cedar Court, Pashan Sus Road, Pashan, Pune 411021", "access_note": "Tower A · Call from the main gate", "parcel_description": "Men's cotton shirts · 2 pieces", "package_category": "Clothing", "weight_kg": 0.7, "payment_type": "cod", "cod_amount": 1849, "delivery_window": "11:00 AM–1:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 10, "order_number": "1051", "customer_name": "Sana Qureshi", "customer_phone": "+1 202-555-0151", "address": "Gulmohar Residency, Salunke Vihar Road, Wanowrie, Pune 411040", "access_note": "Block C · Leave with reception if the customer is unavailable", "parcel_description": "Engineering reference books", "package_category": "Books", "weight_kg": 2.1, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "12:00 PM–2:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 11, "order_number": "1052", "customer_name": "Dev Malhotra", "customer_phone": "+1 202-555-0152", "address": "Park View Apartments, Dhanori Road, Dhanori, Pune 411015", "access_note": "Wing D · Flat 302 · Security will call the resident", "parcel_description": "Compact air fryer", "package_category": "Home appliance", "weight_kg": 4.2, "payment_type": "cod", "cod_amount": 3299, "delivery_window": "1:00 PM–3:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 12, "order_number": "1053", "customer_name": "Tara Kulkarni", "customer_phone": "+1 202-555-0153", "address": "Silver Oak Society, Karve Road, Kothrud, Pune 411038", "access_note": "B Wing · Flat 12 · Ring once and wait", "parcel_description": "Travel organiser set", "package_category": "Travel accessories", "weight_kg": 0.65, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "1:30 PM–3:30 PM", "status": "delivered", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 13, "order_number": "1054", "customer_name": "Ishaan Rao", "customer_phone": "+1 202-555-0154", "address": "Meadow Springs, Sinhagad Road, Dhayari, Pune 411041", "access_note": "Near the community hall · Customer requested a later attempt", "parcel_description": "LED desk lamp", "package_category": "Home & office", "weight_kg": 1.1, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "2:00 PM–4:00 PM", "status": "exception", "exception_reason": "reschedule", "otp_code": DEMO_OTP},
    {"sequence": 14, "order_number": "1055", "customer_name": "Leena Bhosale", "customer_phone": "+1 202-555-0155", "address": "Bluebell Enclave, Keshav Nagar, Mundhwa, Pune 411036", "access_note": "Building 5 · Use the visitor entrance", "parcel_description": "Watercolour paper and art supplies", "package_category": "Art supplies", "weight_kg": 1.4, "payment_type": "cod", "cod_amount": 749, "delivery_window": "2:30 PM–4:30 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 15, "order_number": "1056", "customer_name": "Nikhil Jadhav", "customer_phone": "+1 202-555-0156", "address": "Westend Riverfront, Aundh-Baner Link Road, Aundh, Pune 411007", "access_note": "Tower C · Flat 1102 · Call on arrival", "parcel_description": "Stainless steel cookware set", "package_category": "Kitchenware", "weight_kg": 3.6, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "3:00 PM–5:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 16, "order_number": "1057", "customer_name": "Avni Menon", "customer_phone": "+1 202-555-0157", "address": "Green Acres, Viman Nagar Central, Viman Nagar, Pune 411014", "access_note": "Phase 2 · Block A · Parcel desk is beside the lobby", "parcel_description": "Yoga mat and resistance bands", "package_category": "Fitness", "weight_kg": 1.3, "payment_type": "prepaid", "cod_amount": None, "delivery_window": "4:00 PM–6:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
    {"sequence": 17, "order_number": "1058", "customer_name": "Ritvik Shah", "customer_phone": "+1 202-555-0158", "address": "Pearl Residency, NIBM Road, Kondhwa, Pune 411048", "access_note": "Building B · Flat 705 · Please use the side entrance", "parcel_description": "Cotton bedsheet set", "package_category": "Home textiles", "weight_kg": 1.8, "payment_type": "cod", "cod_amount": 1599, "delivery_window": "5:00 PM–7:00 PM", "status": "pending", "exception_reason": None, "otp_code": DEMO_OTP},
]


def ensure_demo_schema() -> None:
    additions = {
        "delivery_runs": {"is_demo": "BOOLEAN NOT NULL DEFAULT FALSE"},
        "delivery_stops": {
            "parcel_description": "VARCHAR(180) NOT NULL DEFAULT ''",
            "package_category": "VARCHAR(40) NOT NULL DEFAULT ''",
            "weight_kg": "FLOAT",
            "payment_type": "VARCHAR(20) NOT NULL DEFAULT 'prepaid'",
            "cod_amount": "INTEGER",
            "delivery_window": "VARCHAR(80)",
        },
    }
    with engine.begin() as connection:
        inspector = inspect(connection)
        for table, columns in additions.items():
            if not inspector.has_table(table):
                continue
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, definition in columns.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))


def seed_demo_run() -> None:
    with SessionLocal() as db:
        run = db.scalar(select(DeliveryRun).where(DeliveryRun.is_demo.is_(True), DeliveryRun.status == "active").order_by(DeliveryRun.id.desc()))
        if run is None:
            run = DeliveryRun(rider_name="Arjun", status="active", is_demo=True)
            db.add(run)
            db.flush()
            db.add(Activity(run_id=run.id, event_type="run_started", summary="Demo delivery run started · sample data"))

        for values in DEMO_STOPS:
            stop = db.scalar(select(DeliveryStop).where(DeliveryStop.run_id == run.id, DeliveryStop.order_number == values["order_number"]))
            if stop is None:
                stop = DeliveryStop(run_id=run.id, **values)
                db.add(stop)
                db.flush()
            else:
                # Demo runs own these sample verification codes. Repair legacy local
                # rows so their stored OTP matches the documented demo record.
                for field in ("parcel_description", "package_category", "weight_kg", "payment_type", "cod_amount", "delivery_window", "otp_code"):
                    setattr(stop, field, values[field])
            if stop.status == "delivered":
                event_type, summary = "delivered", f"Demo order #{stop.order_number} delivered · sample event"
            elif stop.status == "exception":
                event_type, summary = stop.exception_reason or "exception", f"Demo order #{stop.order_number} needs follow-up · sample event"
            else:
                continue
            existing_event = db.scalar(select(Activity.id).where(Activity.stop_id == stop.id, Activity.event_type == event_type).limit(1))
            if existing_event is None:
                db.add(Activity(run_id=run.id, stop_id=stop.id, event_type=event_type, summary=summary))
        db.commit()


@app.on_event("startup")
def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_demo_schema()
    if engine.dialect.name == "sqlite":
        seed_demo_run()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "sarthi-api"}
