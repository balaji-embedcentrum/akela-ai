import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("akela-worker")

DATABASE_URL = os.getenv("DATABASE_URL")  # Required — no default. Set in .env
REDIS_URL = os.getenv("REDIS_URL")          # Required — no default. Set in .env

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set. Copy .env.example to .env and fill in your values.")
if not REDIS_URL:
    raise RuntimeError("REDIS_URL environment variable is not set. Copy .env.example to .env and fill in your values.")

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session():
    async with AsyncSessionLocal() as session:
        return session


async def job_cleanup():
    logger.info("Running cleanup: marking stale agents offline")
    from tasks.cleanup import mark_stale_agents_offline
    async with AsyncSessionLocal() as db:
        await mark_stale_agents_offline(db)


async def job_task_timeout():
    logger.info("Running task timeout: marking stuck in_progress tasks as blocked")
    from tasks.task_timeout import mark_timed_out_tasks
    async with AsyncSessionLocal() as db:
        await mark_timed_out_tasks(db)


async def job_trust_decay():
    logger.info("Running trust decay for inactive agents")
    from tasks.trust_decay import decay_inactive_agents
    async with AsyncSessionLocal() as db:
        await decay_inactive_agents(db)


async def job_standup():
    logger.info("Triggering daily standup for all orchestrators")
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    from tasks.meeting_trigger import trigger_all_standups
    async with AsyncSessionLocal() as db:
        await trigger_all_standups(db, redis_client)
    await redis_client.close()


async def main():
    scheduler = AsyncIOScheduler()
    scheduler.add_job(job_cleanup, IntervalTrigger(minutes=5), id="cleanup")
    scheduler.add_job(job_task_timeout, IntervalTrigger(minutes=5), id="task_timeout")
    scheduler.add_job(job_trust_decay, IntervalTrigger(hours=1), id="trust_decay")
    scheduler.add_job(job_standup, CronTrigger(hour=9, minute=0), id="standup")
    scheduler.start()
    logger.info("Akela worker started. Run as One.")
    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
