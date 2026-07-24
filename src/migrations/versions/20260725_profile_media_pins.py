"""add avatar history and pinned messages

Revision ID: 20260725_profile_media_pins
Revises: 20260724_message_features
"""

from alembic import op
import sqlalchemy as sa

from utilities import db_settings


revision = "20260725_profile_media_pins"
down_revision = "20260724_message_features"
branch_labels = None
depends_on = None
schema = db_settings.DB_SCHEMA


def upgrade() -> None:
    op.create_table(
        "user_avatars",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("avatar_name", sa.String(), nullable=False),
        sa.Column("avatar_type", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("TIMEZONE('utc', now())"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], [f"{schema}.users.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("avatar_name", name="uq_user_avatars_name"),
        schema=schema,
    )
    op.create_index(
        "ix_user_avatars_user_id",
        "user_avatars",
        ["user_id"],
        schema=schema,
    )
    op.execute(
        sa.text(
            f'INSERT INTO "{schema}".user_avatars '
            "(user_id, avatar_name, avatar_type) "
            f'SELECT id, avatar_name, avatar_type FROM "{schema}".users '
            "WHERE avatar_name IS NOT NULL AND avatar_type IS NOT NULL "
            "ON CONFLICT (avatar_name) DO NOTHING"
        )
    )

    op.create_table(
        "pinned_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("pinned_by", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("TIMEZONE('utc', now())"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            [f"{schema}.conversations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["message_id"], [f"{schema}.messages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["pinned_by"], [f"{schema}.users.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("message_id", name="uq_pinned_messages_message"),
        schema=schema,
    )
    op.create_index(
        "ix_pinned_messages_conversation_id",
        "pinned_messages",
        ["conversation_id"],
        schema=schema,
    )


def downgrade() -> None:
    op.drop_table("pinned_messages", schema=schema)
    op.drop_table("user_avatars", schema=schema)
