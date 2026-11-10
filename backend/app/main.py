from sqlalchemy import inspect, text
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.database import Base, engine
from app.evon import router as evon_router
from app.navigation import router as navigation_router
from app.settings import settings
from app.voice import router as voice_router

app = FastAPI(title="Sarthi API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list({settings.frontend_origin, "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://localhost:5173", "http://localhost:5174"}),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(router)
app.include_router(voice_router)
app.include_router(evon_router)
app.include_router(navigation_router)


def ensure_sqlite_compatibility() -> None:
    """Add fields introduced after the initial SQLite schema for existing installs."""
    additions = {
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


@app.on_event("startup")
def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "sqlite":
        ensure_sqlite_compatibility()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "sarthi-api"}
