import json
import logging
import uuid
from datetime import date, datetime

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Feedback, MemorySummary, Run
from app.services.llm_service import llm_completion, load_prompt

logger = logging.getLogger(__name__)

MEMORY_SUMMARY_PROMPT = """You are the Memory Engine of an autonomous marketing agent. Your job is to synthesize a week's worth of daily debriefs and feedback into a concise weekly summary.

## Your Role

Analyze all the daily runs, their debriefs, and feedback from this period. Identify patterns, trends, and actionable insights that should inform future content generation.

## Output Format

Return a JSON object:

```json
{
  "summary": "2-3 paragraph free-text summary of the week. What was the overall theme? What worked, what didn't? How did the agent evolve over the week?",
  "insights": {
    "top_performing": ["List of content types, angles, or formats that scored highest"],
    "low_performing": ["List of content types, angles, or formats that scored lowest"],
    "feedback_themes": ["Recurring themes from human feedback comments"],
    "recommendations": ["Specific, actionable recommendations for next week"]
  }
}
```

## Guidelines

- Be specific. "Contrarian angles on LinkedIn posts averaged 4.3 rating" is better than "some posts did well."
- If there's not enough data (e.g., first week), say so honestly and make recommendations based on what's available.
- Recommendations should be concrete enough that the planning engine can act on them.
- Look for trends across the week, not just individual days.
"""


async def generate_weekly_summary(
    period_start: date,
    period_end: date,
    db: AsyncSession,
) -> MemorySummary:
    """Generate a weekly memory summary for the given period."""

    # Load all completed runs in the period
    result = await db.execute(
        select(Run).where(
            and_(
                Run.created_at >= datetime.combine(period_start, datetime.min.time()),
                Run.created_at <= datetime.combine(period_end, datetime.max.time()),
                Run.status == "completed",
            )
        ).order_by(Run.created_at)
    )
    runs = result.scalars().all()

    # Collect debriefs and feedback
    runs_data = []
    for run in runs:
        result = await db.execute(
            select(Feedback).where(Feedback.run_id == run.id)
        )
        feedback_rows = result.scalars().all()

        runs_data.append({
            "date": run.created_at.isoformat(),
            "task_type": run.task_type,
            "debrief": run.debrief,
            "feedback": [
                {
                    "asset_index": f.asset_index,
                    "rating": f.rating,
                    "comment": f.comment,
                }
                for f in feedback_rows
            ],
            "output_summary": {
                "planning": run.output.get("planning", {}) if run.output else {},
            },
        })

    # Generate summary via LLM
    summary_input = {
        "period": f"{period_start} to {period_end}",
        "runs": runs_data,
        "total_runs": len(runs_data),
    }

    result = await llm_completion(
        system_prompt=MEMORY_SUMMARY_PROMPT,
        user_prompt=json.dumps(summary_input, indent=2),
        json_mode=True,
        temperature=0.5,
    )

    # Save to DB
    memory = MemorySummary(
        id=uuid.uuid4(),
        period_start=period_start,
        period_end=period_end,
        summary=result.get("summary", ""),
        insights=result.get("insights", {}),
        created_at=datetime.utcnow(),
    )
    db.add(memory)
    await db.commit()
    await db.refresh(memory)

    logger.info(
        "Weekly summary generated for %s to %s (%d runs)",
        period_start,
        period_end,
        len(runs_data),
    )

    return memory
