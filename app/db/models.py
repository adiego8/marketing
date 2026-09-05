import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


# --- Multi-tenant models ---


class Agency(Base):
    __tablename__ = "agencies"

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    google_refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_connected_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="agency")
    clients: Mapped[list["Client"]] = relationship(back_populates="agency")
    task_configs: Mapped[list["TaskConfig"]] = relationship(back_populates="agency")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    agency_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agencies.id"), index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50), default="admin")
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    agency: Mapped["Agency"] = relationship(back_populates="users")


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    agency_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agencies.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    website_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="active", index=True)
    research: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    research_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    branding: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    google_calendar_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.utcnow, onupdate=datetime.utcnow
    )

    agency: Mapped["Agency"] = relationship(back_populates="clients")
    strategies: Mapped[list["Strategy"]] = relationship(back_populates="client")
    campaigns: Mapped[list["Campaign"]] = relationship(back_populates="client")
    runs: Mapped[list["Run"]] = relationship(back_populates="client")
    assets: Mapped[list["Asset"]] = relationship(back_populates="client")
    feedback: Mapped[list["Feedback"]] = relationship(back_populates="client")
    memory_summaries: Mapped[list["MemorySummary"]] = relationship(back_populates="client")


# --- Existing models (with client_id) ---


class Strategy(Base):
    __tablename__ = "strategy"
    __table_args__ = (UniqueConstraint("client_id"),)

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    business_name: Mapped[str] = mapped_column(String(255))
    icp: Mapped[dict] = mapped_column(JSONB, default=dict)
    voice: Mapped[dict] = mapped_column(JSONB, default=dict)
    positioning: Mapped[dict] = mapped_column(JSONB, default=dict)
    messaging: Mapped[dict] = mapped_column(JSONB, default=dict)
    goals: Mapped[dict] = mapped_column(JSONB, default=dict)
    content_quota: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.utcnow, onupdate=datetime.utcnow
    )

    client: Mapped["Client"] = relationship(back_populates="strategies")


class TaskConfig(Base):
    __tablename__ = "task_configs"

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    agency_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agencies.id"), index=True)
    task_type: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    pipeline: Mapped[list] = mapped_column(JSONB, default=list)
    schedule: Mapped[str | None] = mapped_column(String(100), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    agency: Mapped["Agency"] = relationship(back_populates="task_configs")


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    task_type: Mapped[str] = mapped_column(String(100), index=True)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id"), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="running")
    context_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    output: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    debrief: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    slack_message_ts: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    client: Mapped["Client"] = relationship(back_populates="runs")
    campaign: Mapped["Campaign | None"] = relationship()
    feedback: Mapped[list["Feedback"]] = relationship(back_populates="run")
    assets: Mapped[list["Asset"]] = relationship(back_populates="run")


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"), index=True)
    asset_index: Mapped[int] = mapped_column(Integer)
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    client: Mapped["Client"] = relationship(back_populates="feedback")
    run: Mapped["Run"] = relationship(back_populates="feedback")


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="idea", index=True)
    strategy: Mapped[dict] = mapped_column(JSONB, default=dict)
    content_plan: Mapped[dict] = mapped_column(JSONB, default=dict)
    feedback_history: Mapped[list] = mapped_column(JSONB, default=list)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.utcnow, onupdate=datetime.utcnow
    )

    client: Mapped["Client"] = relationship(back_populates="campaigns")
    assets: Mapped[list["Asset"]] = relationship(back_populates="campaign")


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("runs.id"), index=True, nullable=True)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("campaigns.id"), index=True, nullable=True)
    asset_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    type: Mapped[str] = mapped_column(String(50))
    content: Mapped[dict] = mapped_column(JSONB, default=dict)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft", index=True)
    scheduled_for: Mapped[datetime | None] = mapped_column(nullable=True, index=True)
    suggested_scheduled_for: Mapped[datetime | None] = mapped_column(nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    google_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    saved_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    client: Mapped["Client"] = relationship(back_populates="assets")
    run: Mapped["Run | None"] = relationship(back_populates="assets")
    campaign: Mapped["Campaign | None"] = relationship(back_populates="assets")


class MemorySummary(Base):
    __tablename__ = "memory_summaries"

    id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    summary: Mapped[str] = mapped_column(Text)
    insights: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    client: Mapped["Client"] = relationship(back_populates="memory_summaries")
