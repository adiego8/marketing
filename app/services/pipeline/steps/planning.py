import json
import logging

from app.services.llm_service import llm_completion, load_prompt
from app.services.pipeline.base import PipelineStep, RunContext, StepResult
from app.services.pipeline.registry import register_step

logger = logging.getLogger(__name__)


@register_step("planning")
class PlanningStep(PipelineStep):
    """LLM decides today's focus: topic, angle, tone, campaign thread."""

    async def execute(self, context: RunContext, config: dict) -> StepResult:
        prompt_name = config.get("prompt", "planning_daily")
        system_prompt = load_prompt(prompt_name)

        ctx = context.get("context_build", {})
        forced_campaign_id = context.get("forced_campaign_id")

        # If a campaign is forced, filter active_campaigns to just that one
        active_campaigns = ctx.get("active_campaigns", [])
        forced_instruction = None
        if forced_campaign_id:
            active_campaigns = [c for c in active_campaigns if c.get("id") == forced_campaign_id]
            if active_campaigns:
                forced_instruction = f"MANDATORY: You MUST generate content for campaign '{active_campaigns[0]['title']}' (ID: {forced_campaign_id}). No other campaign or freestyle topic is allowed."

        user_prompt = json.dumps(
            {
                "forced_instruction": forced_instruction,
                "strategy": ctx.get("strategy", {}),
                "active_campaigns": active_campaigns,
                "recent_runs": ctx.get("recent_runs", []),
                "recent_feedback": ctx.get("recent_feedback", []),
                "memory_summaries": ctx.get("memory_summaries", []),
            },
            indent=2,
        )

        result = await llm_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            json_mode=True,
        )

        logger.info("Planning complete: topic=%s", result.get("topic"))
        return StepResult(output=result)
