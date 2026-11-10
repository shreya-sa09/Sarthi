"""Remove the obsolete demo marker from delivery runs.

Revision ID: 0002_remove_demo_flag
Revises: 0001_initial_schema
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_remove_demo_flag"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("delivery_runs") as batch_op:
        batch_op.drop_column("is_demo")


def downgrade() -> None:
    with op.batch_alter_table("delivery_runs") as batch_op:
        batch_op.add_column(sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()))
