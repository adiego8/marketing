import uuid
from datetime import datetime

from pydantic import BaseModel


class ClientRead(BaseModel):
    id: uuid.UUID
    agency_id: uuid.UUID
    name: str
    website_url: str | None = None
    logo_url: str | None = None
    description: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    status: str
    research: dict | None = None
    research_status: str | None = None
    branding: dict | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ClientListItem(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    website_url: str | None = None
    logo_url: str | None = None
    contact_email: str | None = None
    research_status: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ClientCreate(BaseModel):
    name: str
    website_url: str | None = None
    logo_url: str | None = None
    description: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    branding: dict | None = None


class ClientUpdate(BaseModel):
    name: str | None = None
    website_url: str | None = None
    logo_url: str | None = None
    description: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    status: str | None = None
    branding: dict | None = None
