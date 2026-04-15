from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from api.config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, echo=False, future=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_all_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await run_migrations()


async def run_migrations():
    """Idempotent schema migrations — safe to run on every startup."""
    migrations = [
        # Phase 7: multi-protocol agent support
        "ALTER TABLE agents ADD COLUMN IF NOT EXISTS protocol VARCHAR NOT NULL DEFAULT 'openai'",
    ]
    async with engine.begin() as conn:
        for sql in migrations:
            await conn.execute(text(sql))
