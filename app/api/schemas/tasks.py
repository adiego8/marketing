import uuid

from pydantic import BaseModel


class TaskConfigRead(BaseModel):
    id: uuid.UUID
    task_type: str
    name: str
    description: str | None = None
    pipeline: list
    schedule: str | None = None
    active: bool

    model_config = {"from_attributes": True}


class TaskConfigCreate(BaseModel):
    task_type: str
    name: str
    description: str | None = None
    pipeline: list
    schedule: str | None = None
    active: bool = True


class TaskConfigUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    pipeline: list | None = None
    schedule: str | None = None
    active: bool | None = None
