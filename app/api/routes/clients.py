import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db
from app.api.schemas.clients import ClientCreate, ClientListItem, ClientRead, ClientUpdate
from app.db.models import Asset, Campaign, Client, Feedback, MemorySummary, Run, Strategy

# Default agency ID (matches migration/seed)
DEFAULT_AGENCY_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

router = APIRouter(tags=["clients"])


@router.get("/clients", response_model=list[ClientListItem])
async def list_clients(
    status: str | None = None,
    search: str | None = None,
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    query = select(Client).order_by(Client.name).limit(limit).offset(offset)
    if status:
        query = query.where(Client.status == status)
    if search:
        query = query.where(Client.name.ilike(f"%{search}%"))
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/clients", response_model=ClientRead, status_code=201)
async def create_client(
    payload: ClientCreate, db: AsyncSession = Depends(get_db)
):
    client = Client(
        id=uuid.uuid4(),
        agency_id=DEFAULT_AGENCY_ID,
        name=payload.name,
        website_url=payload.website_url,
        logo_url=payload.logo_url,
        description=payload.description,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
        status="active",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return client


@router.get("/clients/{client_id}", response_model=ClientRead)
async def get_client(client_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, "Client not found")
    return client


@router.patch("/clients/{client_id}", response_model=ClientRead)
async def update_client(
    client_id: uuid.UUID,
    payload: ClientUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, "Client not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(client, field, value)
    client.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(client)
    return client


@router.delete("/clients/{client_id}")
async def delete_client(client_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, "Client not found")

    # Delete all related data in dependency order
    await db.execute(delete(Feedback).where(Feedback.client_id == client_id))
    await db.execute(delete(Asset).where(Asset.client_id == client_id))
    await db.execute(delete(MemorySummary).where(MemorySummary.client_id == client_id))
    await db.execute(delete(Run).where(Run.client_id == client_id))
    await db.execute(delete(Campaign).where(Campaign.client_id == client_id))
    await db.execute(delete(Strategy).where(Strategy.client_id == client_id))
    await db.delete(client)
    await db.commit()
    return {"deleted": True}
