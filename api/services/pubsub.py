import json
from typing import Any
import redis.asyncio as aioredis


async def publish(channel: str, message: Any, redis_client: aioredis.Redis):
    payload = json.dumps(message, default=str)
    await redis_client.publish(channel, payload)


def task_channel(orchestrator_id: str) -> str:
    return f"akela:tasks:{orchestrator_id}"


def chat_channel(orchestrator_id: str, room: str) -> str:
    return f"akela:chat:{orchestrator_id}:{room}"


def meeting_channel(orchestrator_id: str) -> str:
    return f"akela:meetings:{orchestrator_id}"


SYSTEM_CHANNEL = "akela:system"
