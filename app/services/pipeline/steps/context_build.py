import json
import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import func

from app.db.models import Asset, Campaign, Feedback, MemorySummary, Run, Strategy
from app.services.pipeline.base import PipelineStep, RunContext, StepResult
from app.services.pipeline.registry import register_step

logger = logging.getLogger(__name__)


def _summarize_assets(output: dict) -> list[dict]:
    """Extract a lightweight summary of assets from a run output.

    Strips large fields like base64 images and full slide content
    to keep context window manageable.
    """
    # Try post_production > review > generation
    pp = output.get("post_production", {})
    assets = pp.get("produced_assets", [])
    if not assets:
        review = output.get("review", {})
        assets = review.get("approved_assets", output.get("generation", {}).get("assets", []))

    return [
        {
            "type": a.get("type"),
            "format": a.get("format"),
            "content": a.get("content", "")[:200],
            "rationale": a.get("rationale", {}),
        }
        for a in assets
    ]


@register_step("context_build")
class ContextBuildStep(PipelineStep):
    """Loads strategy, recent runs, feedback, and memory summaries into context."""

    async def execute(self, context: RunContext, config: dict) -> StepResult:
        db: AsyncSession = context["db"]
        client_id = context.get("client_id")
        if client_id:
            client_id = uuid.UUID(client_id) if isinstance(client_id, str) else client_id
        lookback_days = config.get("lookback_days", 14)
        cutoff = datetime.utcnow() - timedelta(days=lookback_days)

        # Load strategy for this client
        query = select(Strategy)
        if client_id:
            query = query.where(Strategy.client_id == client_id)
        else:
            query = query.limit(1)
        result = await db.execute(query)
        strategy = result.scalar_one_or_none()
        if not strategy:
            return StepResult(success=False, error="No strategy configured")

        strategy_data = {
            "business_name": strategy.business_name,
            "icp": strategy.icp,
            "voice": strategy.voice,
            "positioning": strategy.positioning,
            "messaging": strategy.messaging,
            "goals": strategy.goals,
        }

        # Load recent runs
        runs_query = (
            select(Run)
            .where(Run.created_at >= cutoff, Run.status == "completed")
            .order_by(Run.created_at.desc())
            .limit(14)
        )
        if client_id:
            runs_query = runs_query.where(Run.client_id == client_id)
        result = await db.execute(runs_query)
        recent_runs = result.scalars().all()
        runs_data = [
            {
                "task_type": r.task_type,
                "date": r.created_at.isoformat(),
                "planning": r.output.get("planning", {}) if r.output else {},
                "assets_summary": _summarize_assets(r.output) if r.output else [],
                "debrief": r.debrief,
            }
            for r in recent_runs
        ]

        # Load recent feedback
        recent_run_ids = [r.id for r in recent_runs]
        feedback_data = []
        if recent_run_ids:
            result = await db.execute(
                select(Feedback)
                .where(Feedback.run_id.in_(recent_run_ids))
                .order_by(Feedback.created_at.desc())
            )
            feedback_rows = result.scalars().all()
            feedback_data = [
                {
                    "run_id": str(f.run_id),
                    "asset_index": f.asset_index,
                    "rating": f.rating,
                    "comment": f.comment,
                }
                for f in feedback_rows
            ]

        # Load memory summaries (latest 4 weeks)
        mem_query = (
            select(MemorySummary)
            .order_by(MemorySummary.period_end.desc())
            .limit(4)
        )
        if client_id:
            mem_query = mem_query.where(MemorySummary.client_id == client_id)
        result = await db.execute(mem_query)
        summaries = result.scalars().all()
        memory_data = [
            {
                "period": f"{s.period_start} to {s.period_end}",
                "summary": s.summary,
                "insights": s.insights,
            }
            for s in summaries
        ]

        # Load active campaigns with asset progress
        camp_query = select(Campaign).where(Campaign.status == "active")
        if client_id:
            camp_query = camp_query.where(Campaign.client_id == client_id)
        result = await db.execute(camp_query)
        active_campaigns = result.scalars().all()
        campaigns_data = []
        for c in active_campaigns:
            # Count existing assets for this campaign
            result = await db.execute(
                select(func.count(Asset.id)).where(Asset.campaign_id == c.id)
            )
            asset_count = result.scalar() or 0

            campaigns_data.append({
                "id": str(c.id),
                "title": c.title,
                "description": c.description,
                "strategy": c.strategy,
                "content_plan": c.content_plan,
                "assets_created": asset_count,
            })

        assembled_context = {
            "strategy": strategy_data,
            "recent_runs": runs_data,
            "recent_feedback": feedback_data,
            "memory_summaries": memory_data,
            "active_campaigns": campaigns_data,
        }

        logger.info(
            "Context built: %d recent runs, %d feedback items, %d memory summaries, %d active campaigns",
            len(runs_data),
            len(feedback_data),
            len(memory_data),
            len(campaigns_data),
        )

        return StepResult(output=assembled_context)
