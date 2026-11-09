"""Create Sarthi delivery tables.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-11-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "delivery_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rider_name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("is_demo", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "delivery_stops",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("delivery_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("order_number", sa.String(32), nullable=False),
        sa.Column("customer_name", sa.String(120), nullable=False),
        sa.Column("customer_phone", sa.String(32), nullable=False),
        sa.Column("address", sa.String(300), nullable=False),
        sa.Column("access_note", sa.String(300), nullable=False),
        sa.Column("parcel_description", sa.String(180), nullable=False),
        sa.Column("package_category", sa.String(40), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=True),
        sa.Column("payment_type", sa.String(20), nullable=False),
        sa.Column("cod_amount", sa.Integer(), nullable=True),
        sa.Column("delivery_window", sa.String(80), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("exception_reason", sa.String(40), nullable=True),
        sa.Column("otp_code", sa.String(12), nullable=True),
    )
    op.create_index("ix_delivery_stops_run_id", "delivery_stops", ["run_id"])
    op.create_index("ix_delivery_stops_status", "delivery_stops", ["status"])
    op.create_table(
        "activities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("delivery_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stop_id", sa.Integer(), sa.ForeignKey("delivery_stops.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("summary", sa.String(300), nullable=False),
        sa.Column("transcript", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_activities_run_id", "activities", ["run_id"])
    op.create_index("ix_activities_stop_id", "activities", ["stop_id"])
    op.create_index("ix_activities_created_at", "activities", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_activities_created_at", table_name="activities")
    op.drop_index("ix_activities_stop_id", table_name="activities")
    op.drop_index("ix_activities_run_id", table_name="activities")
    op.drop_table("activities")
    op.drop_index("ix_delivery_stops_status", table_name="delivery_stops")
    op.drop_index("ix_delivery_stops_run_id", table_name="delivery_stops")
    op.drop_table("delivery_stops")
    op.drop_table("delivery_runs")
