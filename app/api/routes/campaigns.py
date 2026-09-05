import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import update

from app.api.dependencies import get_client, get_db
from app.api.schemas.campaigns import (
    CampaignCreate,
    CampaignFeedback,
    CampaignGenerate,
    CampaignListItem,
    CampaignRead,
    CampaignReject,
    CampaignUpdate,
)
from app.db.models import Asset, Campaign, Client, Run
from app.services.campaign_service import generate_campaign_ideas, improve_campaign

router = APIRouter(tags=["campaigns"])


@router.get("/clients/{client_id}/campaigns", response_model=list[CampaignListItem])
async def list_campaigns(
    status: str | None = None,
    limit: int = Query(default=50, le=100),
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Campaign)
        .where(Campaign.client_id == client.id)
        .order_by(Campaign.created_at.desc())
        .limit(limit)
    )
    if status:
        query = query.where(Campaign.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/clients/{client_id}/campaigns/{campaign_id}", response_model=CampaignRead)
async def get_campaign(
    campaign_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.client_id == client.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    return campaign


@router.post("/clients/{client_id}/campaigns", response_model=CampaignRead, status_code=201)
async def create_campaign(
    payload: CampaignCreate,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    campaign = Campaign(
        id=uuid.uuid4(),
        client_id=client.id,
        title=payload.title,
        description=payload.description,
        status="idea",
        strategy=payload.strategy or {},
        content_plan=payload.content_plan or {},
        feedback_history=[],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)
    return campaign


@router.patch("/clients/{client_id}/campaigns/{campaign_id}", response_model=CampaignRead)
async def update_campaign(
    campaign_id: uuid.UUID,
    payload: CampaignUpdate,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.client_id == client.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(campaign, field, value)
    campaign.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(campaign)
    return campaign


@router.delete("/clients/{client_id}/campaigns/{campaign_id}")
async def delete_campaign(
    campaign_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.client_id == client.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    # Unlink runs and assets referencing this campaign
    await db.execute(
        update(Run).where(Run.campaign_id == campaign_id).values(campaign_id=None)
    )
    await db.execute(
        update(Asset).where(Asset.campaign_id == campaign_id).values(campaign_id=None)
    )
    await db.delete(campaign)
    await db.commit()
    return {"deleted": True}


@router.post("/clients/{client_id}/campaigns/generate", response_model=list[CampaignRead])
async def generate_campaigns(
    payload: CampaignGenerate,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    campaigns = await generate_campaign_ideas(
        db=db,
        client_id=client.id,
        prompt=payload.prompt,
        count=payload.count,
    )
    return campaigns


@router.post("/clients/{client_id}/campaigns/{campaign_id}/review", response_model=CampaignRead)
async def review_campaign(
    campaign_id: uuid.UUID,
    payload: CampaignFeedback,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.client_id == client.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    history = list(campaign.feedback_history or [])
    history.append({
        "feedback": payload.comment,
        "submitted_at": datetime.utcnow().isoformat(),
    })
    campaign.feedback_history = history
    campaign.status = "in_review"
    campaign.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(campaign)
    return campaign


@router.post("/clients/{client_id}/campaigns/{campaign_id}/improve", response_model=CampaignRead)
async def improve_campaign_endpoint(
    campaign_id: uuid.UUID,
    payload: CampaignFeedback,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.client_id == client.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    improved = await improve_campaign(campaign, payload.comment, db)
    return improved


@router.post("/clients/{client_id}/campaigns/{campaign_id}/accept", response_model=CampaignRead)
async def accept_campaign(
    campaign_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.client_id == client.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    campaign.status = "active"
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(campaign)
    return campaign


@router.post("/clients/{client_id}/campaigns/{campaign_id}/reject", response_model=CampaignRead)
async def reject_campaign(
    campaign_id: uuid.UUID,
    payload: CampaignReject,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.client_id == client.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    campaign.status = "rejected"
    campaign.rejection_reason = payload.reason
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(campaign)
    return campaign


@router.post("/clients/{client_id}/campaigns/{campaign_id}/complete", response_model=CampaignRead)
async def complete_campaign(
    campaign_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.client_id == client.id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    campaign.status = "completed"
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(campaign)
    return campaign
