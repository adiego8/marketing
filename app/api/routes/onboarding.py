import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_client, get_db
from app.api.schemas.onboarding import ProfileRequest, ResearchRequest
from app.api.schemas.strategy import StrategyRead
from app.db.models import Client, Strategy
from app.db.session import async_session
from app.services.research_service import generate_marketing_profile, research_company

logger = logging.getLogger(__name__)

router = APIRouter(tags=["onboarding"])


async def _run_research_background(client_id: uuid.UUID, payload: dict):
    """Background task that runs research and saves results to the client record."""
    async with async_session() as db:
        try:
            result = await research_company(
                company_name=payload["company_name"],
                website_url=payload.get("website_url"),
                description=payload.get("description"),
                competitors=payload.get("competitors"),
                research_focus=payload.get("research_focus"),
            )

            # Save research to client
            client_result = await db.execute(
                select(Client).where(Client.id == client_id)
            )
            client = client_result.scalar_one()
            client.research = result
            client.research_status = "completed"
            client.updated_at = datetime.utcnow()
            await db.commit()
            logger.info("Research completed for client %s", client_id)

        except Exception as e:
            logger.exception("Research failed for client %s: %s", client_id, e)
            client_result = await db.execute(
                select(Client).where(Client.id == client_id)
            )
            client = client_result.scalar_one()
            client.research_status = "failed"
            client.research = {"error": str(e)}
            client.updated_at = datetime.utcnow()
            await db.commit()


@router.post("/clients/{client_id}/onboarding/research")
async def run_research(
    payload: ResearchRequest,
    background_tasks: BackgroundTasks,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    """Start research as a background task. Poll GET /clients/{id} for status."""
    # Set status to researching
    client.research_status = "researching"
    client.updated_at = datetime.utcnow()
    await db.commit()

    # Run in background
    background_tasks.add_task(
        _run_research_background,
        client.id,
        payload.model_dump(),
    )

    return {"status": "researching", "message": "Research started. Poll client for status."}


@router.post("/clients/{client_id}/onboarding/profile", response_model=StrategyRead)
async def create_profile(
    payload: ProfileRequest,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    """Generate a marketing profile from research and save as the client's strategy."""
    profile = await generate_marketing_profile(
        research=payload.research,
        overrides=payload.overrides,
    )

    # Upsert strategy for this client
    result = await db.execute(
        select(Strategy).where(Strategy.client_id == client.id)
    )
    strategy = result.scalar_one_or_none()

    strategy_data = {
        "business_name": profile.get("business_name", ""),
        "icp": profile.get("icp", {}),
        "voice": profile.get("voice", {}),
        "positioning": profile.get("positioning", {}),
        "messaging": profile.get("messaging", {}),
        "goals": {
            **profile.get("goals", {}),
            "content_strategy": profile.get("content_strategy", {}),
        },
        "content_quota": profile.get("content_quota", {}),
    }

    if strategy:
        for field, value in strategy_data.items():
            setattr(strategy, field, value)
        strategy.updated_at = datetime.utcnow()
    else:
        strategy = Strategy(
            id=uuid.uuid4(),
            client_id=client.id,
            **strategy_data,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(strategy)

    await db.commit()
    await db.refresh(strategy)
    return strategy
