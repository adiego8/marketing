import uuid
from datetime import datetime

from pydantic import BaseModel


class RunTriggerResponse(BaseModel):
    run_id: uuid.UUID
    status: str


class RunRead(BaseModel):
    id: uuid.UUID
    task_type: str
    campaign_id: uuid.UUID | None = None
    status: str
    context_snapshot: dict | None = None
    output: dict | None = None
    debrief: dict | None = None
    created_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class RunListItem(BaseModel):
    id: uuid.UUID
    task_type: str
    campaign_id: uuid.UUID | None = None
    status: str
    created_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}
