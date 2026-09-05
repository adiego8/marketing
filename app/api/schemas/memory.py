import uuid
from datetime import date, datetime

from pydantic import BaseModel


class MemorySummaryRead(BaseModel):
    id: uuid.UUID
    period_start: date
    period_end: date
    summary: str
    insights: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class MemorySummaryCreate(BaseModel):
    period_start: date
    period_end: date
