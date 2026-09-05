import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db
from app.api.schemas.tasks import TaskConfigCreate, TaskConfigRead, TaskConfigUpdate
from app.db.models import TaskConfig

router = APIRouter(tags=["tasks"])


@router.get("/tasks", response_model=list[TaskConfigRead])
async def list_tasks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TaskConfig).order_by(TaskConfig.task_type))
    return result.scalars().all()


@router.get("/tasks/{task_type}", response_model=TaskConfigRead)
async def get_task(task_type: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TaskConfig).where(TaskConfig.task_type == task_type)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, f"Task type not found: {task_type}")
    return task


@router.post("/tasks", response_model=TaskConfigRead, status_code=201)
async def create_task(
    payload: TaskConfigCreate, db: AsyncSession = Depends(get_db)
):
    # Check for duplicate
    result = await db.execute(
        select(TaskConfig).where(TaskConfig.task_type == payload.task_type)
    )
    if result.scalar_one_or_none():
        raise HTTPException(409, f"Task type already exists: {payload.task_type}")

    task = TaskConfig(id=uuid.uuid4(), **payload.model_dump())
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


@router.put("/tasks/{task_type}", response_model=TaskConfigRead)
async def update_task(
    task_type: str,
    payload: TaskConfigUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TaskConfig).where(TaskConfig.task_type == task_type)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, f"Task type not found: {task_type}")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(task, field, value)

    await db.commit()
    await db.refresh(task)
    return task
