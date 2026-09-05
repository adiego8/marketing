"""Schedule suggestion step.

Asks the LLM to propose an ISO datetime (UTC) for each produced asset,
considering:
- Asset type / platform best practices
- Target audience / ICP
- Campaign window (if any)
- Other already-scheduled assets for this client (to avoid clustering)

Enriches the produced_assets list in-place with `suggested_scheduled_for`.
Does NOT persist — assets are only persisted when the admin clicks Schedule.
"""
import json
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Asset, Campaign
from app.services.llm_service import llm_completion
from app.services.pipeline.base import PipelineStep, RunContext, StepResult
from app.services.pipeline.registry import register_step

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a marketing scheduling assistant. Given a set of \
marketing assets and their context (type, format, campaign window, audience), \
propose an ideal posting datetime (UTC) for each asset.

Rules:
- Return ISO 8601 UTC datetimes (e.g. "2026-04-20T14:00:00Z")
- Spread posts across days — avoid clustering on the same day
- Prefer mid-morning or early-afternoon UTC for broad reach unless the audience \
timezone is specified
- Respect platform best practices:
  - LinkedIn: Tue–Thu 8-11am local
  - Instagram: daily 10am-2pm or 7-9pm local
  - Twitter/X: weekdays 9am or 5pm local
- Stay within the campaign window if one is provided
- Avoid datetimes that collide with already-scheduled posts

Respond with JSON:
{
  "suggestions": [
    {"asset_index": 0, "scheduled_for": "2026-04-20T14:00:00Z", "reason": "..."},
    ...
  ]
}
"""


@register_step("schedule_suggest")
class ScheduleSuggestStep(PipelineStep):
    async def execute(self, context: RunContext, config: dict) -> StepResult:
        db: AsyncSession = context["db"]
        client_id = context.get("client_id")

        post_prod = context.get("post_production") or {}
        assets = post_prod.get("produced_assets") or []
        if not assets:
            # Fall back to review / generation output
            assets = (
                (context.get("review") or {}).get("approved_assets")
                or (context.get("generation") or {}).get("assets")
                or []
            )
        if not assets:
            return StepResult(output={"suggestions": []})

        strategy = (context.get("context_build") or {}).get("strategy", {})

        # Campaign window (if any)
        campaign_window = None
        forced_campaign_id = context.get("forced_campaign_id")
        if forced_campaign_id:
            result = await db.execute(
                select(Campaign).where(Campaign.id == uuid.UUID(forced_campaign_id))
            )
            campaign = result.scalar_one_or_none()
            if campaign:
                campaign_window = {
                    "start_date": campaign.start_date.isoformat() if campaign.start_date else None,
                    "end_date": campaign.end_date.isoformat() if campaign.end_date else None,
                }

        # Already-scheduled assets for this client (next 30 days)
        already_scheduled = []
        if client_id:
            now = datetime.utcnow()
            result = await db.execute(
                select(Asset).where(
                    Asset.client_id == uuid.UUID(client_id),
                    Asset.scheduled_for.is_not(None),
                    Asset.scheduled_for >= now,
                    Asset.scheduled_for <= now + timedelta(days=30),
                )
            )
            for a in result.scalars().all():
                already_scheduled.append({
                    "type": a.type,
                    "scheduled_for": a.scheduled_for.isoformat() if a.scheduled_for else None,
                })

        payload = {
            "now_utc": datetime.utcnow().isoformat() + "Z",
            "assets": [
                {
                    "asset_index": i,
                    "type": a.get("type"),
                    "format": a.get("format"),
                    "platform_hint": a.get("platform_hint"),
                }
                for i, a in enumerate(assets)
            ],
            "strategy_icp": strategy.get("icp", {}),
            "campaign_window": campaign_window,
            "already_scheduled": already_scheduled,
        }

        try:
            result = await llm_completion(
                system_prompt=SYSTEM_PROMPT,
                user_prompt=json.dumps(payload, indent=2),
                json_mode=True,
            )
        except Exception as e:
            logger.exception("schedule_suggest LLM call failed: %s", e)
            return StepResult(output={"suggestions": [], "error": str(e)})

        suggestions = result.get("suggestions", [])

        # Enrich assets in-place with suggested_scheduled_for
        by_index = {s["asset_index"]: s for s in suggestions if "asset_index" in s}
        for i, asset in enumerate(assets):
            sug = by_index.get(i)
            if sug and sug.get("scheduled_for"):
                asset["suggested_scheduled_for"] = sug["scheduled_for"]
                if sug.get("reason"):
                    asset["schedule_reason"] = sug["reason"]

        logger.info("schedule_suggest: produced %d suggestions", len(suggestions))
        return StepResult(output={"suggestions": suggestions})
