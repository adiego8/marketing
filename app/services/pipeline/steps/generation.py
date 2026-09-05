import json
import logging

from app.services.llm_service import llm_completion, load_prompt
from app.services.pipeline.base import PipelineStep, RunContext, StepResult
from app.services.pipeline.registry import register_step

logger = logging.getLogger(__name__)


@register_step("generation")
class GenerationStep(PipelineStep):
    """LLM generates marketing content: 1 post, 2 hooks, 1 CTA, 1 campaign idea, 1 action."""

    async def execute(self, context: RunContext, config: dict) -> StepResult:
        prompt_name = config.get("prompt", "generation_daily")
        system_prompt = load_prompt(prompt_name)

        ctx = context.get("context_build", {})
        plan = context.get("planning", {})

        # If planning selected a campaign, find its details and pass them
        campaign_context = None
        campaign_id = plan.get("campaign_id")
        if campaign_id:
            for c in ctx.get("active_campaigns", []):
                if c.get("id") == campaign_id:
                    campaign_context = c
                    break

        user_prompt = json.dumps(
            {
                "daily_plan": plan,
                "strategy": ctx.get("strategy", {}),
                "campaign": campaign_context,
            },
            indent=2,
        )

        result = await llm_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            json_mode=True,
        )

        logger.info(
            "Generation complete: %d assets",
            len(result.get("assets", [])),
        )
        return StepResult(output=result)
