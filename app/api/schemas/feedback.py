import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class FeedbackCreate(BaseModel):
    run_id: uuid.UUID
    asset_index: int
    rating: int = Field(ge=1, le=5)
    comment: str | None = None
    save_asset: bool = False


class FeedbackRead(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    asset_index: int
    rating: int
    comment: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
