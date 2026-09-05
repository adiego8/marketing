import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class AssetRead(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID | None = None
    campaign_id: uuid.UUID | None = None
    asset_index: int | None = None
    type: str
    content: dict
    rating: int | None = None
    status: str = "draft"
    scheduled_for: datetime | None = None
    suggested_scheduled_for: datetime | None = None
    posted_at: datetime | None = None
    google_event_id: str | None = None
    saved_at: datetime

    model_config = {"from_attributes": True}


class AssetCreate(BaseModel):
    type: str
    content: dict
    rating: int | None = Field(default=None, ge=1, le=5)
    run_id: uuid.UUID | None = None
    campaign_id: uuid.UUID | None = None
    asset_index: int | None = None


class AssetUpdate(BaseModel):
    type: str | None = None
    content: dict | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    campaign_id: uuid.UUID | None = None


class AssetGenerateRequest(BaseModel):
    type: str
    brief: str
    campaign_id: uuid.UUID | None = None
