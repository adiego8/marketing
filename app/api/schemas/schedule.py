import uuid
from datetime import datetime

from pydantic import BaseModel

from app.api.schemas.assets import AssetRead


class ScheduleRequest(BaseModel):
    scheduled_for: datetime


class CalendarItem(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID | None = None
    campaign_id: uuid.UUID | None = None
    campaign_title: str | None = None
    type: str
    content: dict
    status: str
    scheduled_for: datetime | None = None
    suggested_scheduled_for: datetime | None = None
    posted_at: datetime | None = None
    google_event_id: str | None = None


class GoogleConnectResponse(BaseModel):
    auth_url: str
