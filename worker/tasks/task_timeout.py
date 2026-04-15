"""
Task Timeout — marks HuntTasks that have been in_progress for >10 minutes as blocked.

Run every 5 minutes from the worker scheduler.
"""
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
TIMEOUT_MINUTES = 10


async def mark_timed_out_tasks(db: AsyncSession):
    from api.models.hunt import HuntTask

    cutoff = datetime.utcnow() - timedelta(minutes=TIMEOUT_MINUTES)
    result = await db.execute(
        select(HuntTask).where(
            HuntTask.status == "in_progress",
            HuntTask.updated_at < cutoff,
        )
    )
    tasks = result.scalars().all()
    if not tasks:
        return

    for task in tasks:
        task.status = "blocked"

    await db.commit()
