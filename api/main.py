import asyncio
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import redis.asyncio as aioredis

from api.config import get_settings
from api.db.session import create_all_tables
from api.routers import auth, orchestrators, agents, chat, meetings, trust, conversations, hunt, bridge, projects, push

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_all_tables()
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=True)

    # Start background listener: calls Hermes directly for agents with endpoint_url
    from api.services.endpoint_caller import start_endpoint_listener, start_health_checker
    from api.db.session import AsyncSessionLocal
    asyncio.create_task(start_endpoint_listener(AsyncSessionLocal, app.state.redis))
    asyncio.create_task(start_health_checker(AsyncSessionLocal, app.state.redis))

    yield
    await app.state.redis.close()


app = FastAPI(
    title="Akela",
    description="Run as One. — Open-source agent orchestration framework",
    version="0.1.0",
    lifespan=lifespan,
    root_path="/akela-api",
    root_path_in_servers=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(orchestrators.router)
app.include_router(agents.router)
app.include_router(chat.router)
app.include_router(meetings.router)
app.include_router(trust.router)
app.include_router(conversations.router)
app.include_router(hunt.router)
app.include_router(bridge.router)
app.include_router(projects.router)
app.include_router(push.router)


@app.get("/")
async def root():
    return RedirectResponse(url="/akela-api/docs")

@app.get("/health")
async def health():
    return {"status": "ok", "name": "Akela", "tagline": "Run as One."}
