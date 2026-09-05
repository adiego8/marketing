"""Seed script to insert initial agency, user, client, strategy, and daily task config."""

import asyncio
import uuid
from datetime import datetime

from sqlalchemy import select

from app.db.models import Agency, Client, Strategy, TaskConfig, User
from app.db.session import async_session

# Use fixed UUIDs matching migration defaults
DEFAULT_AGENCY_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEFAULT_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
DEFAULT_CLIENT_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")


async def seed():
    async with async_session() as db:
        # Ensure default agency exists
        result = await db.execute(select(Agency).where(Agency.id == DEFAULT_AGENCY_ID))
        if not result.scalar_one_or_none():
            db.add(Agency(id=DEFAULT_AGENCY_ID, name="Default Agency"))
            print("Agency seeded.")

        # Ensure default user exists
        result = await db.execute(select(User).where(User.id == DEFAULT_USER_ID))
        if not result.scalar_one_or_none():
            db.add(User(
                id=DEFAULT_USER_ID,
                agency_id=DEFAULT_AGENCY_ID,
                email="admin@agency.local",
                name="Admin",
                role="admin",
            ))
            print("User seeded.")

        # Ensure default client exists
        result = await db.execute(select(Client).where(Client.id == DEFAULT_CLIENT_ID))
        if not result.scalar_one_or_none():
            db.add(Client(
                id=DEFAULT_CLIENT_ID,
                agency_id=DEFAULT_AGENCY_ID,
                name="Default Client",
                status="active",
            ))
            print("Client seeded.")

        await db.flush()

        # Check if strategy already exists for default client
        result = await db.execute(
            select(Strategy).where(Strategy.client_id == DEFAULT_CLIENT_ID)
        )
        if result.scalar_one_or_none():
            print("Strategy already exists, skipping seed.")
        else:
            strategy = Strategy(
                id=uuid.uuid4(),
                client_id=DEFAULT_CLIENT_ID,
                business_name="Your Business Name",
                icp={
                    "description": "Define your ideal customer profile",
                    "demographics": {},
                    "pain_points": [],
                    "goals": [],
                },
                voice={
                    "personality": "Define your brand personality",
                    "traits": [],
                    "words_to_use": [],
                    "words_to_avoid": [
                        "revolutionary",
                        "game-changing",
                        "crushing it",
                        "leverage",
                        "synergy",
                        "unlock your potential",
                    ],
                    "tone": "conversational, direct, practical",
                },
                positioning={
                    "angles": [
                        {
                            "type": "contrarian",
                            "description": "Challenge what everyone believes",
                        },
                        {
                            "type": "unique_mechanism",
                            "description": "Lead with HOW, not WHAT",
                        },
                        {
                            "type": "transformation",
                            "description": "Before and after, the gap closed",
                        },
                    ],
                    "anti_positioning": "What you are NOT",
                },
                messaging={
                    "value_props": [],
                    "key_messages": [],
                    "tagline": "",
                },
                goals={
                    "primary": "awareness",
                    "secondary": "leads",
                    "metrics": [],
                },
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.add(strategy)
            print("Strategy seeded.")

        # Check if daily task config exists
        result = await db.execute(
            select(TaskConfig).where(TaskConfig.task_type == "daily")
        )
        if result.scalar_one_or_none():
            print("Daily task config already exists, skipping seed.")
        else:
            daily_config = TaskConfig(
                id=uuid.uuid4(),
                agency_id=DEFAULT_AGENCY_ID,
                task_type="daily",
                name="Daily Marketing Run",
                description="Generates daily marketing content: 1 post, 2 hooks, 1 CTA, 1 campaign idea, 1 recommended action.",
                pipeline=[
                    {"step": "context_build", "config": {"lookback_days": 14}},
                    {"step": "planning", "config": {"prompt": "planning_daily"}},
                    {"step": "generation", "config": {"prompt": "generation_daily"}},
                    {"step": "review", "config": {"prompt": "review_daily", "max_retries": 2}},
                    {"step": "post_production", "config": {"prompt": "post_production_daily", "image_variants": 2}},
                    {"step": "schedule_suggest", "config": {}},
                    {"step": "log_run", "config": {}},
                    {"step": "deliver_slack", "config": {}},
                ],
                schedule="0 8 * * *",
                active=True,
            )
            db.add(daily_config)
            print("Daily task config seeded.")

        await db.commit()
        print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
