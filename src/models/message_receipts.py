from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import OrmBase
from utilities import MessagesStatus, datetime_auto_update


class MessageReceipts(OrmBase):
    __tablename__ = "message_receipts"

    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    status: Mapped[MessagesStatus] = mapped_column(nullable=False)
    updated_at: Mapped[datetime_auto_update]

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_message_receipt"),
        Index("ix_message_receipts_status", "status"),
    )
