"""add reliable message ids, replies, filenames, and reactions

Revision ID: 20260724_message_features
Revises: 20260724_runtime_integrity
"""

from alembic import op
import sqlalchemy as sa

from utilities import db_settings


revision = "20260724_message_features"
down_revision = "20260724_runtime_integrity"
branch_labels = None
depends_on = None
schema = db_settings.DB_SCHEMA


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("original_file_name", sa.String(length=255), nullable=True),
        schema=schema,
    )
    op.add_column(
        "messages",
        sa.Column("client_message_id", sa.String(length=36), nullable=True),
        schema=schema,
    )
    op.add_column(
        "messages",
        sa.Column("reply_to_id", sa.Integer(), nullable=True),
        schema=schema,
    )
    op.create_unique_constraint(
        "uq_messages_sender_client_id",
        "messages",
        ["sender_id", "client_message_id"],
        schema=schema,
    )
    op.create_foreign_key(
        "messages_reply_to_id_fkey",
        "messages",
        "messages",
        ["reply_to_id"],
        ["id"],
        source_schema=schema,
        referent_schema=schema,
        ondelete="SET NULL",
    )
    op.create_table(
        "message_reactions",
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.String(length=16), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["message_id"],
            [f"{schema}.messages.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{schema}.users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("message_id", "user_id"),
        sa.UniqueConstraint(
            "message_id",
            "user_id",
            name="uq_message_reaction_user",
        ),
        schema=schema,
    )


def downgrade() -> None:
    op.drop_table("message_reactions", schema=schema)
    op.drop_constraint(
        "messages_reply_to_id_fkey",
        "messages",
        schema=schema,
        type_="foreignkey",
    )
    op.drop_constraint(
        "uq_messages_sender_client_id",
        "messages",
        schema=schema,
        type_="unique",
    )
    op.drop_column("messages", "reply_to_id", schema=schema)
    op.drop_column("messages", "client_message_id", schema=schema)
    op.drop_column("messages", "original_file_name", schema=schema)
