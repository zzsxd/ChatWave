from sqlalchemy import CheckConstraint, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from database import OrmBase
from utilities import primary_key_type


class UnreadMessages(OrmBase):
    __tablename__ = 'unread_messages'
    id: Mapped[primary_key_type]
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey('conversations.id', ondelete="CASCADE")
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey('users.id', ondelete="CASCADE")
    )
    message_id: Mapped[int] = mapped_column(
        ForeignKey('messages.id', ondelete="CASCADE"),
        nullable=True
    )
    call_id: Mapped[int] = mapped_column(
        ForeignKey('calls.id', ondelete="CASCADE"),
        nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "(message_id IS NULL) <> (call_id IS NULL)",
            name="ck_unread_exactly_one_entity",
        ),
        Index(
            "uq_unread_message_recipient",
            "conversation_id",
            "user_id",
            "message_id",
            unique=True,
            postgresql_where=text("message_id IS NOT NULL"),
        ),
        Index(
            "uq_unread_call_recipient",
            "conversation_id",
            "user_id",
            "call_id",
            unique=True,
            postgresql_where=text("call_id IS NOT NULL"),
        ),
    )
