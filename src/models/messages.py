from sqlalchemy import CheckConstraint, Index, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import OrmBase
from utilities import (
    primary_key_type,
    MessagesStatus,
    text_not_required_type,
    MessagesTypes,
    datetime_auto_set,
    datetime_auto_update
)


class Messages(OrmBase):
    __tablename__ = 'messages'
    id: Mapped[primary_key_type]
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey('conversations.id', ondelete="CASCADE"),
        index=True
    )
    sender_id: Mapped[int] = mapped_column(
        ForeignKey('users.id', ondelete="CASCADE"),
        index=True
    )
    status: Mapped[MessagesStatus] = mapped_column(nullable=False, index=True)
    type: Mapped[MessagesTypes] = mapped_column(nullable=True)
    content: Mapped[text_not_required_type]
    file_content_name: Mapped[text_not_required_type]
    file_content_type: Mapped[text_not_required_type]
    file_size: Mapped[int | None] = mapped_column(nullable=True)
    original_file_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    client_message_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    reply_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    encryption_algorithm: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    encrypted_content: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    voice_transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_language: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
    )
    created_at: Mapped[datetime_auto_set]
    updated_at: Mapped[datetime_auto_update]

    conversation: Mapped["Conversations"] = relationship(
        back_populates="messages"
    )
    sender: Mapped["Users"] = relationship(
        back_populates="messages",
    )
    unread_messages: Mapped[list["UnreadMessages"]] = relationship()

    __table_args__ = (
        Index(
            "ix_messages_conversation_created_at",
            "conversation_id",
            "created_at",
        ),
        UniqueConstraint(
            "sender_id",
            "client_message_id",
            name="uq_messages_sender_client_id",
        ),
        CheckConstraint(
            "(encryption_algorithm IS NULL AND encrypted_content IS NULL) OR "
            "(encryption_algorithm IS NOT NULL AND encrypted_content IS NOT "
            "NULL AND content IS NULL)",
            name="ck_messages_encrypted_payload",
        ),
    )


# async def delete_media_file(mapper, connection, target):
#     if target.file_content_name:
#         file_path = MediaPatches.MEDIA_MESSAGES_FOLDER.value / target.file_content_name
#         await FileManager().delete_file(file_path=file_path)
#
#
# event.listen(Messages, "before_delete", delete_media_file)
