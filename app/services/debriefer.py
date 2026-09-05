import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import settings
from app.db.models import Feedback, Run
from app.services.llm_service import llm_completion, load_prompt
from app.services.slack_service import post_debrief

logger = logging.getLogger(__name__)


async def generate_debrief(run_id: str, db: AsyncSession) -> dict:
    """Generate a debrief summary for a completed run.

    Collects all feedback, sends to LLM for summary generation,
    saves to run record, and posts as Slack thread reply.
    """
    run_uuid = uuid.UUID(run_id)

    # Load run
    result = await db.execute(select(Run).where(Run.id == run_uuid))
    run = result.scalar_one_or_none()
    if not run:
        raise ValueError(f"Run not found: {run_id}")

    # Collect all feedback for this run
    result = await db.execute(
        select(Feedback)
        .where(Feedback.run_id == run_uuid)
        .order_by(Feedback.asset_index)
    )
    feedback_rows = result.scalars().all()

    feedback_data = [
        {
            "asset_index": f.asset_index,
            "rating": f.rating,
            "comment": f.comment,
        }
        for f in feedback_rows
    ]

    # Build debrief input
    system_prompt = load_prompt("debrief")
    debrief_input = {
        "run_output": run.output or {},
        "feedback": feedback_data,
        "task_type": run.task_type,
    }

    # Generate debrief via LLM
    debrief = await llm_completion(
        system_prompt=system_prompt,
        user_prompt=json.dumps(debrief_input, indent=2),
        json_mode=True,
        temperature=0.5,
    )

    # Save debrief to run record
    run.debrief = debrief
    await db.commit()

    # Post as Slack thread reply
    if run.slack_message_ts:
        channel = settings.slack_channel_id
        await post_debrief(channel, run.slack_message_ts, debrief)

    logger.info("Debrief generated and saved for run=%s", run_id)
    return debrief
