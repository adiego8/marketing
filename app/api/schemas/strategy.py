import uuid
from datetime import datetime

from pydantic import BaseModel


class StrategyRead(BaseModel):
    id: uuid.UUID
    business_name: str
    icp: dict
    voice: dict
    positioning: dict
    messaging: dict
    goals: dict
    content_quota: dict = {}
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class StrategyUpdate(BaseModel):
    business_name: str | None = None
    icp: dict | None = None
    voice: dict | None = None
    positioning: dict | None = None
    messaging: dict | None = None
    goals: dict | None = None
    content_quota: dict | None = None
