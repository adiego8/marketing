import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_client, get_db
from app.api.schemas.feedback import FeedbackCreate, FeedbackRead
from app.db.models import Asset, Client, Feedback, Run

router = APIRouter(tags=["feedback"])


@router.post("/clients/{client_id}/feedback", response_model=FeedbackRead)
async def submit_feedback(
    payload: FeedbackCreate,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    # Verify run exists and belongs to client
    result = await db.execute(
        select(Run).where(Run.id == payload.run_id, Run.client_id == client.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run not found")

    # Create feedback record
    feedback = Feedback(
        id=uuid.uuid4(),
        client_id=client.id,
        run_id=payload.run_id,
        asset_index=payload.asset_index,
        rating=payload.rating,
        comment=payload.comment,
        created_at=datetime.utcnow(),
    )
    db.add(feedback)

    # If explicit save requested, persist to assets table
    if payload.save_asset:
        asset_data = _get_asset_from_run(run, payload.asset_index)
        if asset_data:
            # Auto-link to campaign if the run was campaign-driven
            campaign_id = None
            if run.output:
                planning = run.output.get("planning", {})
                cid = planning.get("campaign_id")
                if cid:
                    try:
                        campaign_id = uuid.UUID(cid)
                    except (ValueError, TypeError):
                        pass

            asset = Asset(
                id=uuid.uuid4(),
                client_id=client.id,
                run_id=payload.run_id,
                campaign_id=campaign_id,
                type=asset_data.get("type", "unknown"),
                content=asset_data,
                rating=payload.rating,
                saved_at=datetime.utcnow(),
            )
            db.add(asset)

    await db.commit()
    await db.refresh(feedback)
    return feedback


@router.post("/clients/{client_id}/feedback/{run_id}/debrief")
async def trigger_debrief(
    run_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    from app.services.debriefer import generate_debrief

    result = await db.execute(
        select(Run).where(Run.id == run_id, Run.client_id == client.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run not found")
    if run.debrief:
        return {"status": "already_generated", "debrief": run.debrief}

    debrief = await generate_debrief(str(run_id), db)
    return {"status": "generated", "debrief": debrief}


def _get_asset_from_run(run: Run, asset_index: int) -> dict | None:
    """Extract an asset from the run output by index."""
    if not run.output:
        return None

    # Try post_production first, then review, then generation
    post_prod = run.output.get("post_production", {})
    assets = post_prod.get("produced_assets", [])

    if not assets:
        review = run.output.get("review", {})
        assets = review.get("approved_assets", [])

    if not assets:
        gen = run.output.get("generation", {})
        assets = gen.get("assets", [])

    if 0 <= asset_index < len(assets):
        return assets[asset_index]
    return None
