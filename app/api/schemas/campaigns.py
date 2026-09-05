import uuid
from datetime import date, datetime

from pydantic import BaseModel


class CampaignRead(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None = None
    status: str
    strategy: dict
    content_plan: dict
    feedback_history: list
    rejection_reason: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CampaignListItem(BaseModel):
    id: uuid.UUID
    title: str
    status: str
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CampaignCreate(BaseModel):
    title: str
    description: str | None = None
    strategy: dict | None = None
    content_plan: dict | None = None


class CampaignUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    strategy: dict | None = None
    content_plan: dict | None = None
    start_date: date | None = None
    end_date: date | None = None


class CampaignFeedback(BaseModel):
    comment: str


class CampaignReject(BaseModel):
    reason: str


class CampaignGenerate(BaseModel):
    prompt: str | None = None
    count: int = 3
