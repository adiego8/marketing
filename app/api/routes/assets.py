import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_client, get_db
from app.api.schemas.assets import AssetCreate, AssetGenerateRequest, AssetRead, AssetUpdate
from app.db.models import Asset, Campaign, Client, Strategy
from app.services.llm_service import llm_completion, load_prompt
import json

router = APIRouter(tags=["assets"])


@router.post("/clients/{client_id}/assets/generate")
async def generate_asset(
    payload: AssetGenerateRequest,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    """AI-generate a single asset based on strategy + optional campaign + brief."""
    # Load strategy for this client
    result = await db.execute(
        select(Strategy).where(Strategy.client_id == client.id)
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise HTTPException(400, "No strategy configured")

    strategy_data = {
        "business_name": strategy.business_name,
        "icp": strategy.icp,
        "voice": strategy.voice,
        "positioning": strategy.positioning,
        "messaging": strategy.messaging,
        "goals": strategy.goals,
    }

    # Load campaign if provided
    campaign_data = None
    if payload.campaign_id:
        result = await db.execute(
            select(Campaign).where(
                Campaign.id == payload.campaign_id,
                Campaign.client_id == client.id,
            )
        )
        campaign = result.scalar_one_or_none()
        if campaign:
            campaign_data = {
                "title": campaign.title,
                "description": campaign.description,
                "strategy": campaign.strategy,
                "content_plan": campaign.content_plan,
            }

    system_prompt = load_prompt("asset_single")
    user_prompt = json.dumps({
        "type": payload.type,
        "brief": payload.brief,
        "strategy": strategy_data,
        "campaign": campaign_data,
    }, indent=2)

    result = await llm_completion(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        json_mode=True,
    )

    return {
        "type": payload.type,
        "content": result.get("content", ""),
        "campaign_id": str(payload.campaign_id) if payload.campaign_id else None,
    }


@router.get("/clients/{client_id}/assets", response_model=list[AssetRead])
async def list_assets(
    type: str | None = None,
    min_rating: int | None = None,
    campaign_id: str | None = None,
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Asset)
        .where(Asset.client_id == client.id)
        .order_by(Asset.saved_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if type:
        query = query.where(Asset.type == type)
    if min_rating is not None:
        query = query.where(Asset.rating >= min_rating)
    if campaign_id:
        query = query.where(Asset.campaign_id == uuid.UUID(campaign_id))
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/clients/{client_id}/assets/{asset_id}", response_model=AssetRead)
async def get_asset(
    asset_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Asset).where(Asset.id == asset_id, Asset.client_id == client.id)
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset not found")
    return asset


@router.post("/clients/{client_id}/assets", response_model=AssetRead, status_code=201)
async def create_asset(
    payload: AssetCreate,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    asset = Asset(
        id=uuid.uuid4(),
        client_id=client.id,
        run_id=payload.run_id,
        campaign_id=payload.campaign_id,
        type=payload.type,
        content=payload.content,
        rating=payload.rating,
        saved_at=datetime.utcnow(),
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset


@router.patch("/clients/{client_id}/assets/{asset_id}", response_model=AssetRead)
async def update_asset(
    asset_id: uuid.UUID,
    payload: AssetUpdate,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Asset).where(Asset.id == asset_id, Asset.client_id == client.id)
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(asset, field, value)

    await db.commit()
    await db.refresh(asset)
    return asset


@router.delete("/clients/{client_id}/assets/{asset_id}")
async def delete_asset(
    asset_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Asset).where(Asset.id == asset_id, Asset.client_id == client.id)
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset not found")
    await db.delete(asset)
    await db.commit()
    return {"deleted": True}
