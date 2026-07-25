"""add E2EE device keys and to-device transport

Revision ID: 20260725_e2ee_transport
Revises: 20260725_profile_media_pins
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from utilities import db_settings


revision = "20260725_e2ee_transport"
down_revision = "20260725_profile_media_pins"
branch_labels = None
depends_on = None
schema = db_settings.DB_SCHEMA


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("encryption_algorithm", sa.String(length=64), nullable=True),
        schema=schema,
    )
    op.add_column(
        "messages",
        sa.Column("encrypted_content", postgresql.JSONB(), nullable=True),
        schema=schema,
    )
    op.create_check_constraint(
        "ck_messages_encrypted_payload",
        "messages",
        "(encryption_algorithm IS NULL AND encrypted_content IS NULL) OR "
        "(encryption_algorithm IS NOT NULL AND encrypted_content IS NOT NULL "
        "AND content IS NULL)",
        schema=schema,
    )

    op.create_table(
        "e2ee_devices",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("access_secret_hash", sa.String(length=64), nullable=False),
        sa.Column("device_keys", postgresql.JSONB(), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("TIMEZONE('utc', now())"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("TIMEZONE('utc', now())"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(),
            server_default=sa.text("TIMEZONE('utc', now())"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], [f"{schema}.users.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "device_id"),
        schema=schema,
    )
    op.create_index(
        "ix_e2ee_devices_updated_at",
        "e2ee_devices",
        ["updated_at"],
        schema=schema,
    )

    op.create_table(
        "e2ee_one_time_keys",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("key_id", sa.String(length=255), nullable=False),
        sa.Column("algorithm", sa.String(length=64), nullable=False),
        sa.Column("key_data", postgresql.JSONB(), nullable=False),
        sa.Column(
            "is_fallback",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("TIMEZONE('utc', now())"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id", "device_id"],
            [
                f"{schema}.e2ee_devices.user_id",
                f"{schema}.e2ee_devices.device_id",
            ],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "device_id", "key_id"),
        schema=schema,
    )
    op.create_index(
        "ix_e2ee_one_time_keys_algorithm",
        "e2ee_one_time_keys",
        ["algorithm"],
        schema=schema,
    )

    op.create_table(
        "e2ee_to_device_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("sender_user_id", sa.Integer(), nullable=False),
        sa.Column("recipient_user_id", sa.Integer(), nullable=False),
        sa.Column("recipient_device_id", sa.String(length=128), nullable=False),
        sa.Column("event_type", sa.String(length=255), nullable=False),
        sa.Column("transaction_id", sa.String(length=128), nullable=False),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("TIMEZONE('utc', now())"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["sender_user_id"], [f"{schema}.users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["recipient_user_id"], [f"{schema}.users.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "sender_user_id",
            "transaction_id",
            "recipient_user_id",
            "recipient_device_id",
            "event_type",
            name="uq_e2ee_to_device_delivery",
        ),
        schema=schema,
    )
    op.create_index(
        "ix_e2ee_to_device_recipient",
        "e2ee_to_device_events",
        ["recipient_user_id", "recipient_device_id", "id"],
        schema=schema,
    )
    op.create_table(
        "e2ee_key_backups",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column("encrypted_data", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("TIMEZONE('utc', now())"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("TIMEZONE('utc', now())"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], [f"{schema}.users.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id"),
        schema=schema,
    )


def downgrade() -> None:
    op.drop_table("e2ee_key_backups", schema=schema)
    op.drop_table("e2ee_to_device_events", schema=schema)
    op.drop_table("e2ee_one_time_keys", schema=schema)
    op.drop_table("e2ee_devices", schema=schema)
    op.drop_constraint(
        "ck_messages_encrypted_payload",
        "messages",
        schema=schema,
        type_="check",
    )
    op.drop_column("messages", "encrypted_content", schema=schema)
    op.drop_column("messages", "encryption_algorithm", schema=schema)
