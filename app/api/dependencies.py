import uuid
from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Client
from app.db.session import async_session


async def get_db() -> AsyncGenerator[AsyncSession]:
    async with async_session() as session:
        yield session


async def get_client(
    client_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> Client:
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, "Client not found")
    if client.status == "archived":
        raise HTTPException(400, "Client is archived")
    return client
