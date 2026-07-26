"""add cached voice message transcripts

Revision ID: 20260726_voice_transcripts
Revises: 20260725_e2ee_transport
"""

from alembic import op
import sqlalchemy as sa

from utilities import db_settings


revision = "20260726_voice_transcripts"
down_revision = "20260725_e2ee_transport"
branch_labels = None
depends_on = None
schema = db_settings.DB_SCHEMA


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("voice_transcript", sa.Text(), nullable=True),
        schema=schema,
    )
    op.add_column(
        "messages",
        sa.Column("transcript_language", sa.String(length=16), nullable=True),
        schema=schema,
    )


def downgrade() -> None:
    op.drop_column("messages", "transcript_language", schema=schema)
    op.drop_column("messages", "voice_transcript", schema=schema)
