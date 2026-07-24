"""fix runtime schema drift and enforce sender membership

Revision ID: 20260724_runtime_integrity
Revises: 20260724_triggers
"""

from alembic import op
import sqlalchemy as sa

from utilities import db_settings


revision = "20260724_runtime_integrity"
down_revision = "20260724_triggers"
branch_labels = None
depends_on = None
schema = db_settings.DB_SCHEMA


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        schema=schema,
    )
    op.alter_column(
        "conversations",
        "created_at",
        existing_type=sa.DateTime(),
        existing_nullable=False,
        server_default=sa.text("TIMEZONE('utc', now())"),
        schema=schema,
    )

    op.drop_constraint(
        "calls_conversation_id_fkey",
        "calls",
        schema=schema,
        type_="foreignkey",
    )
    op.drop_constraint(
        "calls_caller_id_fkey",
        "calls",
        schema=schema,
        type_="foreignkey",
    )
    op.create_foreign_key(
        "calls_conversation_id_fkey",
        "calls",
        "conversations",
        ["conversation_id"],
        ["id"],
        source_schema=schema,
        referent_schema=schema,
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "calls_caller_id_fkey",
        "calls",
        "users",
        ["caller_id"],
        ["id"],
        source_schema=schema,
        referent_schema=schema,
        ondelete="CASCADE",
    )

    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {schema}.enforce_message_sender_membership()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = pg_catalog
        AS $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM {schema}.conversations_members
                WHERE conversation_id = NEW.conversation_id
                  AND user_id = NEW.sender_id
                FOR KEY SHARE
            ) THEN
                RAISE EXCEPTION 'message sender is not a conversation member'
                    USING ERRCODE = '23503';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER enforce_message_sender_membership_trigger
        BEFORE INSERT OR UPDATE OF conversation_id, sender_id
        ON {schema}.messages
        FOR EACH ROW
        EXECUTE FUNCTION {schema}.enforce_message_sender_membership()
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        DROP TRIGGER IF EXISTS enforce_message_sender_membership_trigger
        ON {schema}.messages
        """
    )
    op.execute(
        f"DROP FUNCTION IF EXISTS {schema}.enforce_message_sender_membership()"
    )

    op.drop_constraint(
        "calls_caller_id_fkey",
        "calls",
        schema=schema,
        type_="foreignkey",
    )
    op.drop_constraint(
        "calls_conversation_id_fkey",
        "calls",
        schema=schema,
        type_="foreignkey",
    )
    op.create_foreign_key(
        "calls_caller_id_fkey",
        "calls",
        "users",
        ["caller_id"],
        ["id"],
        source_schema=schema,
        referent_schema=schema,
    )
    op.create_foreign_key(
        "calls_conversation_id_fkey",
        "calls",
        "conversations",
        ["conversation_id"],
        ["id"],
        source_schema=schema,
        referent_schema=schema,
    )

    op.alter_column(
        "conversations",
        "created_at",
        existing_type=sa.DateTime(),
        existing_nullable=False,
        server_default=None,
        schema=schema,
    )
    op.drop_column("messages", "file_size", schema=schema)
