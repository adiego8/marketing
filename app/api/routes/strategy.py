import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_client, get_db
from app.api.schemas.strategy import StrategyRead, StrategyUpdate
from app.db.models import Client, Strategy

router = APIRouter(tags=["strategy"])


@router.get("/clients/{client_id}/strategy", response_model=StrategyRead)
async def get_strategy(
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Strategy).where(Strategy.client_id == client.id)
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise HTTPException(status_code=404, detail="No strategy configured")
    return strategy


@router.put("/clients/{client_id}/strategy", response_model=StrategyRead)
async def update_strategy(
    payload: StrategyUpdate,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Strategy).where(Strategy.client_id == client.id)
    )
    strategy = result.scalar_one_or_none()

    if strategy:
        for field, value in payload.model_dump(exclude_none=True).items():
            setattr(strategy, field, value)
        strategy.updated_at = datetime.utcnow()
    else:
        strategy = Strategy(
            client_id=client.id,
            **payload.model_dump(exclude_none=True),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(strategy)

    await db.commit()
    await db.refresh(strategy)
    return strategy
