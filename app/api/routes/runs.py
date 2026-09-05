import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_client, get_db
from app.api.schemas.runs import RunListItem, RunRead, RunTriggerResponse
from app.db.models import Client, Run, TaskConfig
from app.db.session import async_session

router = APIRouter(tags=["runs"])


async def _execute_pipeline(task_type: str, run_id: uuid.UUID, client_id: uuid.UUID, campaign_id: str | None = None):
    """Background task that runs the pipeline."""
    import app.services.pipeline.steps  # noqa: F401
    from app.services.pipeline.runner import run_pipeline

    async with async_session() as db:
        try:
            await run_pipeline(task_type, db, run_id=run_id, client_id=client_id, campaign_id=campaign_id)
        except Exception:
            pass  # Error already logged and saved by runner


@router.post("/clients/{client_id}/runs/tasks/{task_type}", response_model=RunTriggerResponse)
async def trigger_run(
    task_type: str,
    background_tasks: BackgroundTasks,
    campaign_id: str | None = None,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    # Verify task config exists
    result = await db.execute(
        select(TaskConfig).where(TaskConfig.task_type == task_type)
    )
    task_config = result.scalar_one_or_none()
    if not task_config:
        raise HTTPException(404, f"No task config for type: {task_type}")
    if not task_config.active:
        raise HTTPException(400, f"Task type '{task_type}' is not active")

    # Create run record
    run = Run(
        id=uuid.uuid4(),
        client_id=client.id,
        task_type=task_type,
        campaign_id=uuid.UUID(campaign_id) if campaign_id else None,
        status="running",
        created_at=datetime.utcnow(),
    )
    db.add(run)
    await db.commit()

    # Run pipeline in background
    background_tasks.add_task(_execute_pipeline, task_type, run.id, client.id, campaign_id)

    return RunTriggerResponse(run_id=run.id, status="running")


@router.get("/clients/{client_id}/runs", response_model=list[RunListItem])
async def list_runs(
    task_type: str | None = None,
    status: str | None = None,
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Run)
        .where(Run.client_id == client.id)
        .order_by(Run.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if task_type:
        query = query.where(Run.task_type == task_type)
    if status:
        query = query.where(Run.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/clients/{client_id}/runs/{run_id}", response_model=RunRead)
async def get_run(
    run_id: uuid.UUID,
    client: Client = Depends(get_client),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Run).where(Run.id == run_id, Run.client_id == client.id)
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run not found")
    return run
