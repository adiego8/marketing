import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Run, TaskConfig
from app.services.pipeline.base import RunContext, StepResult
from app.services.pipeline.registry import get_step

logger = logging.getLogger(__name__)


async def run_pipeline(
    task_type: str,
    db: AsyncSession,
    run_id: uuid.UUID | None = None,
    client_id: uuid.UUID | None = None,
    campaign_id: str | None = None,
) -> uuid.UUID:
    """Execute a full pipeline for the given task type.

    Args:
        task_type: The task type to run.
        db: Database session.
        run_id: If provided, use an existing run record instead of creating one.
        client_id: The client this run belongs to.
        campaign_id: If provided, force the run to serve this campaign.

    Returns the run ID.
    """
    # Load task config
    result = await db.execute(
        select(TaskConfig).where(TaskConfig.task_type == task_type)
    )
    task_config = result.scalar_one_or_none()
    if not task_config:
        raise ValueError(f"No task config found for type: {task_type}")
    if not task_config.active:
        raise ValueError(f"Task type '{task_type}' is not active")

    # Load or create run record
    if run_id:
        result = await db.execute(select(Run).where(Run.id == run_id))
        run = result.scalar_one()
    else:
        run = Run(
            id=uuid.uuid4(),
            client_id=client_id,
            task_type=task_type,
            status="running",
            created_at=datetime.utcnow(),
        )
        db.add(run)
        await db.commit()

    context = RunContext()
    context["run_id"] = str(run.id)
    context["task_type"] = task_type
    context["client_id"] = str(client_id) if client_id else None
    context["db"] = db
    if campaign_id:
        context["forced_campaign_id"] = campaign_id

    try:
        for step_def in task_config.pipeline:
            step_key = step_def["step"]
            step_config = step_def.get("config", {})

            logger.info("Running step: %s (run=%s)", step_key, run.id)

            step = get_step(step_key)
            result: StepResult = await step.execute(context, step_config)

            if not result.success:
                raise RuntimeError(
                    f"Step '{step_key}' failed: {result.error}"
                )

            context[step_key] = result.output
            logger.info("Step %s completed (run=%s)", step_key, run.id)

        # Mark completed
        run.status = "completed"
        run.output = {
            k: v for k, v in context.items() if k not in ("db", "run_id", "task_type", "client_id")
        }
        run.completed_at = datetime.utcnow()
        await db.commit()

    except Exception as e:
        logger.exception("Pipeline failed (run=%s): %s", run.id, e)
        run.status = "failed"
        pipeline_output = {
            k: v for k, v in context.items() if k not in ("db", "run_id", "task_type", "client_id")
        }
        pipeline_output["error"] = str(e)
        run.output = pipeline_output
        run.completed_at = datetime.utcnow()
        await db.commit()
        raise

    return run.id
