"""add unread integrity constraints and message query index

Revision ID: 20260724_integrity
Revises: 20260724_receipts
"""

from alembic import op
import sqlalchemy as sa

from utilities import db_settings


revision = "20260724_integrity"
down_revision = "20260724_receipts"
branch_labels = None
depends_on = None
schema = db_settings.DB_SCHEMA


def upgrade() -> None:
    # Normalize legacy rows before enforcing the XOR invariant. Rows without an
    # entity cannot identify an event; if both are present, the message wins.
    op.execute(
        sa.text(
            f"""
            DELETE FROM {schema}.unread_messages
            WHERE message_id IS NULL AND call_id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE {schema}.unread_messages
            SET call_id = NULL
            WHERE message_id IS NOT NULL AND call_id IS NOT NULL
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            DELETE FROM {schema}.unread_messages AS duplicate
            USING {schema}.unread_messages AS keep
            WHERE duplicate.id > keep.id
              AND duplicate.conversation_id = keep.conversation_id
              AND duplicate.user_id = keep.user_id
              AND (
                    (
                        duplicate.message_id IS NOT NULL
                        AND duplicate.message_id = keep.message_id
                    )
                    OR
                    (
                        duplicate.call_id IS NOT NULL
                        AND duplicate.call_id = keep.call_id
                    )
              )
            """
        )
    )
    op.create_check_constraint(
        "ck_unread_exactly_one_entity",
        "unread_messages",
        "(message_id IS NULL) <> (call_id IS NULL)",
        schema=schema,
    )
    op.create_index(
        "uq_unread_message_recipient",
        "unread_messages",
        ["conversation_id", "user_id", "message_id"],
        unique=True,
        schema=schema,
        postgresql_where=sa.text("message_id IS NOT NULL"),
    )
    op.create_index(
        "uq_unread_call_recipient",
        "unread_messages",
        ["conversation_id", "user_id", "call_id"],
        unique=True,
        schema=schema,
        postgresql_where=sa.text("call_id IS NOT NULL"),
    )
    op.create_index(
        "ix_messages_conversation_created_at",
        "messages",
        ["conversation_id", "created_at"],
        schema=schema,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_messages_conversation_created_at",
        table_name="messages",
        schema=schema,
    )
    op.drop_index(
        "uq_unread_call_recipient",
        table_name="unread_messages",
        schema=schema,
    )
    op.drop_index(
        "uq_unread_message_recipient",
        table_name="unread_messages",
        schema=schema,
    )
    op.drop_constraint(
        "ck_unread_exactly_one_entity",
        "unread_messages",
        schema=schema,
        type_="check",
    )
