from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import OrmBase
from utilities import datetime_auto_set, primary_key_type


class UserAvatars(OrmBase):
    __tablename__ = "user_avatars"

    id: Mapped[primary_key_type]
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    avatar_name: Mapped[str] = mapped_column(String, nullable=False)
    avatar_type: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime_auto_set]

    __table_args__ = (
        UniqueConstraint("avatar_name", name="uq_user_avatars_name"),
    )
