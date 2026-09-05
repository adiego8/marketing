import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Run
from app.services.pipeline.base import PipelineStep, RunContext, StepResult
from app.services.pipeline.registry import register_step

logger = logging.getLogger(__name__)


@register_step("log_run")
class LogRunStep(PipelineStep):
    """Persists the pipeline output to the run record."""

    async def execute(self, context: RunContext, config: dict) -> StepResult:
        db: AsyncSession = context["db"]
        run_id = uuid.UUID(context["run_id"])

        result = await db.execute(select(Run).where(Run.id == run_id))
        run = result.scalar_one()

        # Collect pipeline outputs (exclude internal keys)
        pipeline_output = {
            k: v for k, v in context.items() if k not in ("db", "run_id", "task_type", "client_id")
        }

        run.context_snapshot = context.get("context_build", {})
        run.output = pipeline_output
        await db.commit()

        logger.info("Run %s output logged to DB", run_id)
        return StepResult(output={"logged": True})
