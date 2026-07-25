from datetime import datetime

from sqlalchemy import (
    BigInteger,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from database import OrmBase


class E2EEDevices(OrmBase):
    __tablename__ = "e2ee_devices"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    device_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    access_secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    device_keys: Mapped[dict] = mapped_column(JSONB, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=text("TIMEZONE('utc', now())"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=text("TIMEZONE('utc', now())"),
        onupdate=text("TIMEZONE('utc', now())"),
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=text("TIMEZONE('utc', now())"),
    )
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)


class E2EEOneTimeKeys(OrmBase):
    __tablename__ = "e2ee_one_time_keys"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "device_id"],
            ["e2ee_devices.user_id", "e2ee_devices.device_id"],
            ondelete="CASCADE",
        ),
    )

    user_id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    key_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    algorithm: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    key_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    is_fallback: Mapped[bool] = mapped_column(
        nullable=False,
        server_default=text("false"),
    )
    created_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=text("TIMEZONE('utc', now())"),
    )


class E2EEToDeviceEvents(OrmBase):
    __tablename__ = "e2ee_to_device_events"
    __table_args__ = (
        UniqueConstraint(
            "sender_user_id",
            "transaction_id",
            "recipient_user_id",
            "recipient_device_id",
            "event_type",
            name="uq_e2ee_to_device_delivery",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    sender_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recipient_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recipient_device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    event_type: Mapped[str] = mapped_column(String(255), nullable=False)
    transaction_id: Mapped[str] = mapped_column(String(128), nullable=False)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=text("TIMEZONE('utc', now())"),
    )


class E2EEKeyBackups(OrmBase):
    __tablename__ = "e2ee_key_backups"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    version: Mapped[int] = mapped_column(nullable=False, server_default=text("1"))
    encrypted_data: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=text("TIMEZONE('utc', now())"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=text("TIMEZONE('utc', now())"),
        onupdate=text("TIMEZONE('utc', now())"),
    )
