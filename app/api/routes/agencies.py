import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db
from app.api.schemas.agencies import AgencyRead, AgencyUpdate
from app.db.models import Agency

router = APIRouter(tags=["agencies"])

DEFAULT_AGENCY_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


def _serialize(agency: Agency) -> dict:
    return {
        "id": agency.id,
        "name": agency.name,
        "google_connected_email": agency.google_connected_email,
        "google_connected": bool(agency.google_refresh_token),
        "created_at": agency.created_at,
    }


@router.get("/agencies/current", response_model=AgencyRead)
async def get_current_agency(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agency).where(Agency.id == DEFAULT_AGENCY_ID))
    agency = result.scalar_one_or_none()
    if not agency:
        raise HTTPException(404, "Agency not found")
    return _serialize(agency)


@router.patch("/agencies/current", response_model=AgencyRead)
async def update_current_agency(
    payload: AgencyUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Agency).where(Agency.id == DEFAULT_AGENCY_ID))
    agency = result.scalar_one_or_none()
    if not agency:
        raise HTTPException(404, "Agency not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(agency, field, value)

    await db.commit()
    await db.refresh(agency)
    return _serialize(agency)
