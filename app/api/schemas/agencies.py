import uuid
from datetime import datetime

from pydantic import BaseModel


class AgencyRead(BaseModel):
    id: uuid.UUID
    name: str
    google_connected_email: str | None = None
    google_connected: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class AgencyUpdate(BaseModel):
    name: str | None = None
