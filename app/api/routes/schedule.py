import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_client, get_db
from app.api.routes.agencies import DEFAULT_AGENCY_ID
from app.api.schemas.assets import AssetRead
from app.api.schemas.schedule import CalendarItem, ScheduleRequest
from app.db.models import Agency, Asset, Campaign, Client, Run
from app.services import event_brief, google_calendar

logger = logging.getLogger(__name__)

router = APIRouter(tags=["schedule"])


def _to_naive_utc(dt: datetime) -> datetime:
    """Normalize to naive UTC — DB columns are TIMESTAMP WITHOUT TIME ZONE."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


async def _get_agency(db: AsyncSession) -> Agency:
    result = await db.execute(select(Agency).where(Agency.id == DEFAULT_AGENCY_ID))
    agency = result.scalar_one_or_none()
    if not agency:
        raise HTTPException(404, "Agency not found")
    return agency


async def _ensure_client_calendar(agency: Agency, client: Client, db: AsyncSession) -> str:
    if client.google_calendar_id:
        return client.google_calendar_id
    calendar_id = google_calendar.create_client_calendar(agency, client)
    client.google_calendar_id = calendar_id
    await db.commit()
    return calendar_id


def _extract_asset_from_run(run: Run, asset_index: int) -> dict:
    """Pull the asset dict out of a run's pipeline output at a given index."""
    output = run.output or {}
    # Deepest stage available
    post_prod = (output.get("post_production") or {}).get("produced_assets") or []
    review = (output.get("review") or {}).get("approved_assets") or []
    generation = (output.get("generation") or {}).get("assets") or []
    source = post_prod or review or generation
    if asset_index < 0 or asset_index >= len(source):
        raise HTTPException(404, f"Asset index {asset_index} not found in run")
    return source[asset_index]


async def _upsert_asset(
    db: AsyncSession,
    client: Client,
    run: Run,
    asset_data: dict,
    asset_index: int,
) -> Asset:
    """Find or create an Asset row for (run_id, asset_index)."""
    result = await db.execute(
        select(Asset).where(
            and_(Asset.run_id == run.id, Asset.asset_index == asset_index)
        )
    )
    asset = result.scalar_one_or_none()
    if asset is None:
        asset = Asset(
            id=uuid.uuid4(),
            client_id=client.id,
            run_id=run.id,
            campaign_id=run.campaign_id,
            asset_index=asset_index,
            type=asset_data.get("type", "post"),
            content=asset_data,
            status="draft",
        )
        db.add(asset)
        await db.flush()
    else:
        # Keep latest content snapshot in sync
        asset.content = asset_data
    return asset


def _client_dict(client: Client) -> dict:
    return {
        "id": str(client.id),
        "name": client.name,
        "logo_url": client.logo_url,
        "branding": client.branding,
    }


@router.post(
    "/clients/{client_id}/runs/{run_id}/assets/{asset_index}/schedule",
    response_model=AssetRead,
)
async def schedule_asset(
    run_id: uuid.UUID,
    asset_index: int,
    payload: ScheduleRequest,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    """Persist the asset (if needed) and create/update a Google Calendar event."""
    agency = await _get_agency(db)
    if not agency.google_refresh_token:
        raise HTTPException(400, "Google Calendar not connected")

    # Load run + verify ownership
    result = await db.execute(
        select(Run).where(Run.id == run_id, Run.client_id == client.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run not found")

    asset_data = _extract_asset_from_run(run, asset_index)
    asset = await _upsert_asset(db, client, run, asset_data, asset_index)

    # Resolve campaign title for the event
    campaign_title = None
    if run.campaign_id:
        result = await db.execute(select(Campaign).where(Campaign.id == run.campaign_id))
        campaign = result.scalar_one_or_none()
        if campaign:
            campaign_title = campaign.title

    # Ensure calendar exists
    calendar_id = await _ensure_client_calendar(agency, client, db)

    title = event_brief.build_event_title(asset_data, campaign_title)
    description = event_brief.build_event_description(
        asset_data, _client_dict(client), campaign_title, run_id=str(run.id)
    )

    scheduled_for_utc = _to_naive_utc(payload.scheduled_for)
    # Google API needs an aware datetime — reattach UTC for the API call
    scheduled_for_aware = scheduled_for_utc.replace(tzinfo=timezone.utc)

    if asset.google_event_id:
        google_calendar.update_event(
            agency, calendar_id, asset.google_event_id,
            title=title, description=description, start=scheduled_for_aware,
        )
    else:
        event_id = google_calendar.create_event(
            agency, calendar_id, title, description, scheduled_for_aware,
        )
        asset.google_event_id = event_id

    asset.scheduled_for = scheduled_for_utc
    asset.status = "scheduled"
    await db.commit()
    await db.refresh(asset)
    return asset


@router.post(
    "/clients/{client_id}/assets/{asset_id}/posted",
    response_model=AssetRead,
)
async def mark_asset_posted(
    asset_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    agency = await _get_agency(db)
    result = await db.execute(
        select(Asset).where(Asset.id == asset_id, Asset.client_id == client.id)
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset not found")

    asset.posted_at = datetime.utcnow()
    asset.status = "posted"

    if client.google_calendar_id and asset.google_event_id and agency.google_refresh_token:
        try:
            google_calendar.update_event(
                agency,
                client.google_calendar_id,
                asset.google_event_id,
                title=f"[POSTED] {asset.type.replace('_', ' ').title()}",
            )
        except Exception:
            logger.exception("Failed to update Google event for posted status")

    await db.commit()
    await db.refresh(asset)
    return asset


@router.delete(
    "/clients/{client_id}/assets/{asset_id}/schedule",
    response_model=AssetRead,
)
async def unschedule_asset(
    asset_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    agency = await _get_agency(db)
    result = await db.execute(
        select(Asset).where(Asset.id == asset_id, Asset.client_id == client.id)
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset not found")

    if client.google_calendar_id and asset.google_event_id and agency.google_refresh_token:
        try:
            google_calendar.delete_event(
                agency, client.google_calendar_id, asset.google_event_id,
            )
        except Exception:
            logger.exception("Failed to delete Google event")

    asset.google_event_id = None
    asset.scheduled_for = None
    asset.status = "draft"
    asset.posted_at = None

    await db.commit()
    await db.refresh(asset)
    return asset


@router.get("/clients/{client_id}/calendar", response_model=list[CalendarItem])
async def get_calendar(
    start: date = Query(...),
    end: date = Query(...),
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    """Return scheduled assets in the date range, joined with campaign title."""
    start_dt = datetime.combine(start, datetime.min.time())
    end_dt = datetime.combine(end, datetime.max.time())

    result = await db.execute(
        select(Asset, Campaign.title)
        .outerjoin(Campaign, Asset.campaign_id == Campaign.id)
        .where(
            Asset.client_id == client.id,
            Asset.scheduled_for.is_not(None),
            Asset.scheduled_for >= start_dt,
            Asset.scheduled_for <= end_dt,
        )
        .order_by(Asset.scheduled_for)
    )
    rows = result.all()
    return [
        CalendarItem(
            id=asset.id,
            run_id=asset.run_id,
            campaign_id=asset.campaign_id,
            campaign_title=campaign_title,
            type=asset.type,
            content=asset.content,
            status=asset.status,
            scheduled_for=asset.scheduled_for,
            suggested_scheduled_for=asset.suggested_scheduled_for,
            posted_at=asset.posted_at,
            google_event_id=asset.google_event_id,
        )
        for asset, campaign_title in rows
    ]


@router.get("/clients/{client_id}/calendar/urls")
async def get_calendar_urls(
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    """Return embed + open URLs for this client's calendar (if one exists)."""
    if not client.google_calendar_id:
        return {
            "calendar_id": None,
            "embed_url": None,
            "open_url": None,
        }
    return {
        "calendar_id": client.google_calendar_id,
        "embed_url": google_calendar.calendar_embed_url(client.google_calendar_id),
        "open_url": google_calendar.calendar_open_url(client.google_calendar_id),
    }
