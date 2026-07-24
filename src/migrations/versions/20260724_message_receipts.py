"""add per-user message receipts

Revision ID: 20260724_receipts
Revises: 98b3db371ae1
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from utilities import db_settings


revision = "20260724_receipts"
down_revision = "98b3db371ae1"
branch_labels = None
depends_on = None
schema = db_settings.DB_SCHEMA


def upgrade():
    message_status = postgresql.ENUM(
        "CREATED",
        "SENT",
        "DELIVERED",
        "READ",
        name="messagesstatus",
        schema=schema,
        create_type=False,
    )
    op.create_table(
        "message_receipts",
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("status", message_status, nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["message_id"], [f"{schema}.messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], [f"{schema}.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("message_id", "user_id"),
        sa.UniqueConstraint("message_id", "user_id", name="uq_message_receipt"),
        schema=schema,
    )
    op.create_index(
        "ix_message_receipts_status",
        "message_receipts",
        ["status"],
        schema=schema,
    )
    op.execute(
        sa.text(
            f"""
            INSERT INTO {schema}.message_receipts (message_id, user_id, status)
            SELECT message_id, user_id, 'SENT'
            FROM {schema}.unread_messages
            WHERE message_id IS NOT NULL
            ON CONFLICT (message_id, user_id) DO NOTHING
            """
        )
    )


def downgrade():
    op.drop_index(
        "ix_message_receipts_status",
        table_name="message_receipts",
        schema=schema,
    )
    op.drop_table("message_receipts", schema=schema)
