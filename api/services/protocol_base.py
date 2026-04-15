"""
BaseAgentCaller — shared contract and utilities for agent protocol implementations.

New protocols should subclass this and implement:
  - fetch_card(endpoint_url) → AgentCardResponse | None
  - ping(endpoint_url) → bool

Shared utilities (used by all callers):
  - build_meta(usage, start_ts, soul) → dict   — timing + token stats
  - publish_words(...)                           — word-by-word streaming fallback
"""

import json
from abc import ABC, abstractmethod
from datetime import datetime
from api.services import pubsub
from api.schemas.agent import AgentCardResponse


class BaseAgentCaller(ABC):

    @staticmethod
    def build_meta(usage: dict, start_ts: datetime, soul: dict | None = None) -> dict:
        """Build standard response metadata from usage stats and timing."""
        soul = soul or {}
        duration_ms = (datetime.utcnow() - start_ts).total_seconds() * 1000
        completion_tokens = usage.get("completion_tokens", 0)
        tokens_per_sec = (
            round(completion_tokens / (duration_ms / 1000), 1)
            if completion_tokens and duration_ms > 0
            else 0.0
        )
        return {
            "usage": {**usage, "model": soul.get("model", "")},
            "tokens_per_sec": tokens_per_sec,
            "duration_ms": round(duration_ms),
            "model": soul.get("model", ""),
        }

    @staticmethod
    async def publish_words(
        full_text: str,
        agent_name: str,
        room: str,
        stream_id: str,
        redis_client,
        orchestrator_id: str = "",
    ) -> None:
        """Publish response word-by-word for live typing UX (non-streaming fallback)."""
        words = full_text.split(" ")
        accumulated = ""
        for i, word in enumerate(words):
            accumulated += ("" if i == 0 else " ") + word
            if i % 3 == 0 or i == len(words) - 1:
                await redis_client.publish(
                    pubsub.chat_channel(orchestrator_id, room),
                    json.dumps({
                        "type": "stream_chunk",
                        "stream_id": stream_id,
                        "sender_name": agent_name,
                        "full_text": accumulated,
                    }),
                )

    @classmethod
    @abstractmethod
    async def fetch_card(cls, endpoint_url: str) -> AgentCardResponse | None:
        """Fetch agent metadata / capabilities from the given endpoint."""
        ...

    @classmethod
    @abstractmethod
    async def ping(cls, endpoint_url: str) -> bool:
        """Return True if the endpoint is reachable."""
        ...
