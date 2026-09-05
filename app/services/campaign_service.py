import json
import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Campaign, Strategy
from app.services.llm_service import llm_completion, load_prompt

logger = logging.getLogger(__name__)


async def generate_campaign_ideas(
    db: AsyncSession,
    client_id: uuid.UUID,
    prompt: str | None = None,
    count: int = 3,
) -> list[Campaign]:
    """Generate campaign proposals using LLM based on current strategy."""

    # Load strategy for this client
    result = await db.execute(
        select(Strategy).where(Strategy.client_id == client_id)
    )
    strategy = result.scalar_one_or_none()
    if not strategy:
        raise ValueError("No strategy configured")

    # Load existing campaigns to avoid duplicates
    result = await db.execute(
        select(Campaign)
        .where(
            Campaign.client_id == client_id,
            Campaign.status.in_(["idea", "proposal", "in_review", "active"]),
        )
        .order_by(Campaign.created_at.desc())
        .limit(10)
    )
    existing = result.scalars().all()
    existing_titles = [c.title for c in existing]

    system_prompt = load_prompt("campaign_generator")
    user_input = {
        "strategy": {
            "business_name": strategy.business_name,
            "icp": strategy.icp,
            "voice": strategy.voice,
            "positioning": strategy.positioning,
            "messaging": strategy.messaging,
            "goals": strategy.goals,
        },
        "content_quota": strategy.content_quota or {},
        "existing_campaigns": existing_titles,
        "count": count,
        "user_prompt": prompt or "Generate diverse campaign ideas based on the strategy.",
    }

    result = await llm_completion(
        system_prompt=system_prompt,
        user_prompt=json.dumps(user_input, indent=2),
        json_mode=True,
        temperature=0.8,
    )

    campaigns = []
    for idea in result.get("campaigns", []):
        campaign = Campaign(
            id=uuid.uuid4(),
            client_id=client_id,
            title=idea.get("title", "Untitled Campaign"),
            description=idea.get("description", ""),
            status="proposal",
            strategy=idea.get("strategy", {}),
            content_plan=idea.get("content_plan", {}),
            feedback_history=[],
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(campaign)
        campaigns.append(campaign)

    await db.commit()
    for c in campaigns:
        await db.refresh(c)

    logger.info("Generated %d campaign proposals", len(campaigns))
    return campaigns


async def improve_campaign(
    campaign: Campaign,
    feedback: str,
    db: AsyncSession,
) -> Campaign:
    """Improve a campaign based on human feedback using LLM."""

    system_prompt = load_prompt("campaign_improver")
    user_input = {
        "campaign": {
            "title": campaign.title,
            "description": campaign.description,
            "strategy": campaign.strategy,
            "content_plan": campaign.content_plan,
        },
        "feedback_history": campaign.feedback_history,
        "new_feedback": feedback,
    }

    result = await llm_completion(
        system_prompt=system_prompt,
        user_prompt=json.dumps(user_input, indent=2),
        json_mode=True,
        temperature=0.6,
    )

    # Update campaign
    campaign.title = result.get("title", campaign.title)
    campaign.description = result.get("description", campaign.description)
    campaign.strategy = result.get("strategy", campaign.strategy)
    campaign.content_plan = result.get("content_plan", campaign.content_plan)

    # Append to feedback history
    history = list(campaign.feedback_history or [])
    history.append({
        "feedback": feedback,
        "improved_at": datetime.utcnow().isoformat(),
        "changes": result.get("changes_made", ""),
    })
    campaign.feedback_history = history
    campaign.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(campaign)

    logger.info("Campaign '%s' improved based on feedback", campaign.title)
    return campaign
