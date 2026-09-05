import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select

from app.config.settings import settings
from app.db.models import Asset, Feedback, Run
from app.db.session import async_session

logger = logging.getLogger(__name__)

router = APIRouter(tags=["slack"])


def _verify_slack_signature(body: bytes, timestamp: str, signature: str) -> bool:
    """Verify the request came from Slack."""
    if abs(time.time() - int(timestamp)) > 60 * 5:
        return False
    sig_basestring = f"v0:{timestamp}:{body.decode('utf-8')}"
    my_signature = (
        "v0="
        + hmac.new(
            settings.slack_signing_secret.encode(),
            sig_basestring.encode(),
            hashlib.sha256,
        ).hexdigest()
    )
    return hmac.compare_digest(my_signature, signature)


@router.post("/slack/interactions")
async def slack_interactions(request: Request):
    body = await request.body()
    timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
    signature = request.headers.get("X-Slack-Signature", "")

    if settings.app_env != "development":
        if not _verify_slack_signature(body, timestamp, signature):
            raise HTTPException(403, "Invalid Slack signature")

    # Slack sends form-encoded payload
    from urllib.parse import parse_qs

    parsed = parse_qs(body.decode("utf-8"))
    payload = json.loads(parsed.get("payload", ["{}"])[0])

    action_type = payload.get("type")

    if action_type == "block_actions":
        await _handle_block_action(payload)
    elif action_type == "view_submission":
        pass  # Future: handle modal submissions

    return {"ok": True}


async def _handle_block_action(payload: dict):
    """Route Slack block actions to handlers."""
    actions = payload.get("actions", [])
    if not actions:
        return

    action = actions[0]
    action_id = action.get("action_id", "")
    value = json.loads(action.get("value", "{}"))

    if action_id.startswith("rate_"):
        await _handle_rating(value)
    elif action_id.startswith("save_"):
        await _handle_save(value)
    elif action_id.startswith("debrief_"):
        await _handle_debrief_trigger(value)


async def _handle_rating(value: dict):
    """Handle a rating button click."""
    run_id = value.get("run_id")
    asset_index = value.get("asset_index")
    rating = value.get("rating")

    if not all([run_id, asset_index is not None, rating]):
        return

    async with async_session() as db:
        feedback = Feedback(
            id=uuid.uuid4(),
            run_id=uuid.UUID(run_id),
            asset_index=asset_index,
            rating=rating,
            created_at=datetime.utcnow(),
        )
        db.add(feedback)
        await db.commit()
        logger.info("Rating %d saved for run=%s asset=%d", rating, run_id, asset_index)


async def _handle_save(value: dict):
    """Handle a Save button click — persist asset to assets table."""
    run_id = value.get("run_id")
    asset_index = value.get("asset_index")

    if not all([run_id, asset_index is not None]):
        return

    async with async_session() as db:
        result = await db.execute(
            select(Run).where(Run.id == uuid.UUID(run_id))
        )
        run = result.scalar_one_or_none()
        if not run or not run.output:
            return

        # Extract asset from run output
        from app.api.routes.feedback import _get_asset_from_run

        asset_data = _get_asset_from_run(run, asset_index)
        if not asset_data:
            return

        # Get the latest rating for this asset if any
        result = await db.execute(
            select(Feedback)
            .where(Feedback.run_id == uuid.UUID(run_id), Feedback.asset_index == asset_index)
            .order_by(Feedback.created_at.desc())
            .limit(1)
        )
        latest_feedback = result.scalar_one_or_none()
        rating = latest_feedback.rating if latest_feedback else None

        asset = Asset(
            id=uuid.uuid4(),
            run_id=uuid.UUID(run_id),
            type=asset_data.get("type", "unknown"),
            content=asset_data,
            rating=rating,
            saved_at=datetime.utcnow(),
        )
        db.add(asset)
        await db.commit()
        logger.info("Asset saved for run=%s asset=%d", run_id, asset_index)


async def _handle_debrief_trigger(value: dict):
    """Handle the Close & Debrief button — trigger debrief generation."""
    run_id = value.get("run_id")
    if not run_id:
        return

    # Import here to avoid circular imports
    from app.services.debriefer import generate_debrief

    async with async_session() as db:
        await generate_debrief(run_id, db)
