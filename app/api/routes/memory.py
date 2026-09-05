from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_client, get_db
from app.api.schemas.memory import MemorySummaryCreate, MemorySummaryRead
from app.db.models import Client, MemorySummary
from app.services.memory_service import generate_weekly_summary

router = APIRouter(tags=["memory"])


@router.get("/clients/{client_id}/memory/summaries", response_model=list[MemorySummaryRead])
async def list_summaries(
    limit: int = Query(default=10, le=50),
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MemorySummary)
        .where(MemorySummary.client_id == client.id)
        .order_by(MemorySummary.period_end.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/clients/{client_id}/memory/summaries", response_model=MemorySummaryRead)
async def create_summary(
    payload: MemorySummaryCreate,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    summary = await generate_weekly_summary(
        period_start=payload.period_start,
        period_end=payload.period_end,
        db=db,
        client_id=client.id,
    )
    return summary
