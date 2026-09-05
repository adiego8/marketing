import json
import logging

from app.services.llm_service import llm_completion, llm_image_generation, load_prompt
from app.services.pipeline.base import PipelineStep, RunContext, StepResult
from app.services.pipeline.registry import register_step

logger = logging.getLogger(__name__)


@register_step("post_production")
class PostProductionStep(PipelineStep):
    """Decides format per asset, generates visuals, writes creative rationale.

    For each asset:
    - Decides format (carousel, single image, reel, story, static graphic)
    - Generates visual assets via image generation
    - Writes creative brief: WHY this post, WHY this format, target moment, expected outcome
    """

    async def execute(self, context: RunContext, config: dict) -> StepResult:
        prompt_name = config.get("prompt", "post_production_daily")
        image_variants = config.get("image_variants", 2)
        generate_images = config.get("generate_images", True)
        system_prompt = load_prompt(prompt_name)

        ctx = context.get("context_build", {})
        plan = context.get("planning", {})
        review = context.get("review", {})
        assets = review.get("approved_assets", context.get("generation", {}).get("assets", []))

        # Step 1: LLM decides format + writes rationale for each asset
        production_input = {
            "assets": assets,
            "daily_plan": plan,
            "strategy": ctx.get("strategy", {}),
            "recent_feedback": ctx.get("recent_feedback", [])[:5],
        }

        production_plan = await llm_completion(
            system_prompt=system_prompt,
            user_prompt=json.dumps(production_input, indent=2),
            json_mode=True,
        )

        produced_assets = production_plan.get("produced_assets", [])

        # Step 2: Generate images for assets that need them
        if generate_images:
            for asset in produced_assets:
                image_prompt = asset.get("image_prompt")
                if image_prompt:
                    try:
                        image_urls = await llm_image_generation(
                            prompt=image_prompt,
                            n=min(image_variants, 2),
                        )
                        asset["generated_images"] = image_urls
                        logger.info(
                            "Generated %d images for asset type=%s",
                            len(image_urls),
                            asset.get("type"),
                        )
                    except Exception as e:
                        logger.warning(
                            "Image generation failed for asset type=%s: %s",
                            asset.get("type"),
                            e,
                        )
                        asset["generated_images"] = []
                        asset["image_error"] = str(e)

        logger.info("Post production complete: %d assets produced", len(produced_assets))

        return StepResult(
            output={
                "produced_assets": produced_assets,
                "review_notes": review.get("review_notes", []),
            }
        )
