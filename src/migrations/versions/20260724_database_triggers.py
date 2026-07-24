"""install database notification triggers

Revision ID: 20260724_triggers
Revises: 20260724_integrity
"""

from alembic import op

from utilities import db_settings


revision = "20260724_triggers"
down_revision = "20260724_integrity"
branch_labels = None
depends_on = None
schema = db_settings.DB_SCHEMA


def upgrade() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {schema}.unread_messages_changes()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = pg_catalog
        AS $$
        BEGIN
            PERFORM pg_notify(
                'unread_messages_changes',
                CASE WHEN TG_OP = 'INSERT' THEN NEW.user_id ELSE OLD.user_id END::text
            );
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {schema}.recipients_change()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = pg_catalog
        AS $$
        BEGIN
            IF TG_OP = 'INSERT' THEN
                PERFORM pg_notify(
                    'recipients_change',
                    json_build_object(
                        'user_id', NEW.user_id,
                        'conversation_id', NEW.conversation_id
                    )::text
                );
            ELSE
                PERFORM pg_notify(
                    'recipients_change',
                    json_build_object(
                        'user_id', OLD.user_id,
                        'conversation_id', OLD.conversation_id
                    )::text
                );
            END IF;
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {schema}.user_delete()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = pg_catalog
        AS $$
        BEGIN
            IF OLD.avatar_name IS NOT NULL THEN
                PERFORM pg_notify('user_delete', OLD.avatar_name::text);
            END IF;
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {schema}.conversation_delete()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = pg_catalog
        AS $$
        BEGIN
            IF OLD.avatar_name IS NOT NULL THEN
                PERFORM pg_notify('conversation_delete', OLD.avatar_name::text);
            END IF;
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {schema}.messages_delete()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = pg_catalog
        AS $$
        BEGIN
            IF OLD.file_content_name IS NOT NULL THEN
                PERFORM pg_notify('messages_delete', OLD.file_content_name::text);
            END IF;
            RETURN NULL;
        END;
        $$
        """
    )

    trigger_definitions = (
        ("unread_messages_trigger", "unread_messages", "INSERT OR DELETE", "unread_messages_changes"),
        ("recipients_change_trigger", "conversations_members", "INSERT OR DELETE", "recipients_change"),
        ("user_delete_trigger", "users", "DELETE", "user_delete"),
        ("conversation_delete_trigger", "conversations", "DELETE", "conversation_delete"),
        ("messages_delete_trigger", "messages", "DELETE", "messages_delete"),
    )
    for trigger, table, events, function in trigger_definitions:
        op.execute(f"DROP TRIGGER IF EXISTS {trigger} ON {schema}.{table}")
        op.execute(
            f"""
            CREATE TRIGGER {trigger}
            AFTER {events} ON {schema}.{table}
            FOR EACH ROW
            EXECUTE FUNCTION {schema}.{function}()
            """
        )


def downgrade() -> None:
    trigger_definitions = (
        ("unread_messages_trigger", "unread_messages"),
        ("recipients_change_trigger", "conversations_members"),
        ("user_delete_trigger", "users"),
        ("conversation_delete_trigger", "conversations"),
        ("messages_delete_trigger", "messages"),
    )
    for trigger, table in trigger_definitions:
        op.execute(f"DROP TRIGGER IF EXISTS {trigger} ON {schema}.{table}")

    for function in (
        "unread_messages_changes",
        "recipients_change",
        "user_delete",
        "conversation_delete",
        "messages_delete",
    ):
        op.execute(f"DROP FUNCTION IF EXISTS {schema}.{function}()")
