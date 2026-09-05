import json
import logging

from app.services.llm_service import llm_completion, load_prompt
from app.services.pipeline.base import PipelineStep, RunContext, StepResult
from app.services.pipeline.registry import register_step

logger = logging.getLogger(__name__)


@register_step("review")
class ReviewStep(PipelineStep):
    """Separate LLM call that reviews generated content for quality.

    Checks voice consistency, AI tells, repetition, quality, CTA clarity.
    If review fails, re-triggers generation up to max_retries times.
    """

    async def execute(self, context: RunContext, config: dict) -> StepResult:
        prompt_name = config.get("prompt", "review_daily")
        max_retries = config.get("max_retries", 2)
        system_prompt = load_prompt(prompt_name)

        ctx = context.get("context_build", {})
        generated = context.get("generation", {})

        for attempt in range(max_retries + 1):
            review_input = {
                "assets": generated.get("assets", []),
                "voice_profile": ctx.get("strategy", {}).get("voice", {}),
                "recent_runs": ctx.get("recent_runs", [])[:3],
                "attempt": attempt + 1,
            }

            result = await llm_completion(
                system_prompt=system_prompt,
                user_prompt=json.dumps(review_input, indent=2),
                json_mode=True,
                temperature=0.3,
            )

            passed = result.get("passed", False)
            if passed:
                logger.info("Review passed on attempt %d", attempt + 1)
                return StepResult(
                    output={
                        "approved_assets": result.get("assets", generated.get("assets", [])),
                        "review_notes": result.get("notes", []),
                        "attempts": attempt + 1,
                    }
                )

            logger.info(
                "Review failed on attempt %d: %s",
                attempt + 1,
                result.get("rejection_reason", "unknown"),
            )

            # If not the last attempt, regenerate with review feedback
            if attempt < max_retries:
                from app.services.pipeline.steps.generation import GenerationStep

                gen_step = GenerationStep()
                # Add review feedback to context so generator can improve
                context["review_feedback"] = result.get("notes", [])
                gen_result = await gen_step.execute(
                    context, config.get("generation_config", {"prompt": "generation_daily"})
                )
                if gen_result.success:
                    generated = gen_result.output
                    context["generation"] = generated

        # Max retries exhausted — pass through with warnings
        logger.warning("Review exhausted %d retries, passing with warnings", max_retries)
        return StepResult(
            output={
                "approved_assets": generated.get("assets", []),
                "review_notes": result.get("notes", []),
                "review_warning": "Passed after max retries with remaining issues",
                "attempts": max_retries + 1,
            }
        )
