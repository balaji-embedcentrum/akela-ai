"""
ACP Caller — IBM/BeeAI Agent Communication Protocol client.

Supports:
- Agent discovery:  GET {endpoint}/agents
- Non-streaming:    POST {endpoint}/runs  (stream: false)
- Streaming:        POST {endpoint}/runs  (stream: true, SSE)

ACP wire format:
  Request:  { "agent_name": "...", "input": [{"parts": [{"text": "..."}]}], "stream": true }
  Response: SSE lines → data: {"type": "message", "message": {"parts": [{"text": "..."}]}}
            or sync → { "run_id": "...", "status": "completed", "output": [{"parts": [...]}] }

Returns the same (full_text, meta, stream_id) tuple as endpoint_caller / a2a_caller.
"""

import json
import uuid
import logging
import httpx
from datetime import datetime
from api.services import pubsub
from api.services.protocol_base import BaseAgentCaller
from api.schemas.agent import AgentCardResponse

logger = logging.getLogger(__name__)


class ACPCaller(BaseAgentCaller):
    """ACP (IBM/BeeAI) protocol implementation."""

    @classmethod
    async def fetch_card(cls, endpoint_url: str) -> AgentCardResponse | None:
        return await fetch_acp_agent_card(endpoint_url)

    @classmethod
    async def ping(cls, endpoint_url: str) -> bool:
        return await ping_acp_endpoint(endpoint_url)


# ---------------------------------------------------------------------------
# Agent discovery
# ---------------------------------------------------------------------------

async def fetch_acp_agent_card(endpoint_url: str) -> AgentCardResponse | None:
    """
    Fetch agent metadata from GET {endpoint}/agents.
    Returns None if unreachable or malformed.
    """
    url = f"{endpoint_url.rstrip('/')}/agents"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return None
            data = resp.json()
    except Exception as e:
        logger.warning(f"acp_caller: failed to fetch agent list from {url}: {e}")
        return None

    agents = data.get("agents") or []
    if not agents:
        return None

    # Use first agent in the list
    first = agents[0] if isinstance(agents[0], dict) else {}
    name = first.get("name", "")
    description = first.get("description", "")
    metadata = first.get("metadata") or {}
    skills = [s if isinstance(s, str) else s.get("name", "") for s in (first.get("skills") or [])]
    skills = [s for s in skills if s]
    model = metadata.get("model", "")

    return AgentCardResponse(
        name=name,
        description=description,
        skills=skills,
        model=model,
        streaming=True,  # ACP always supports streaming
        raw=data,
    )


# ---------------------------------------------------------------------------
# ACP run call
# ---------------------------------------------------------------------------

async def call_acp(
    agent,  # Agent ORM object
    content: str,
    room: str,
    redis_client,
    history: list[dict] | None = None,
    orchestrator_id: str = "",
) -> tuple[str, dict, str]:
    """
    Send a run to an ACP agent and stream the response back to Redis.
    Returns (full_text, meta, stream_id).
    """
    endpoint_url = agent.endpoint_url.rstrip("/")
    stream_id = str(uuid.uuid4())[:8]
    start_ts = datetime.utcnow()
    soul = agent.soul or {}

    # Determine agent name to use — ACP POST /runs requires agent_name
    acp_agent_name = soul.get("acp_agent_name") or agent.name

    full_text, usage = await _call_run(
        endpoint_url, acp_agent_name, content, room, agent.name,
        stream_id, redis_client, history, orchestrator_id,
    )

    meta = BaseAgentCaller.build_meta(usage, start_ts, soul)
    return full_text, meta, stream_id


# ---------------------------------------------------------------------------
# POST /runs — try streaming first, fall back to sync
# ---------------------------------------------------------------------------

async def _call_run(
    endpoint_url: str,
    acp_agent_name: str,
    content: str,
    room: str,
    display_name: str,
    stream_id: str,
    redis_client,
    history: list[dict] | None,
    orchestrator_id: str = "",
) -> tuple[str, dict]:
    url = f"{endpoint_url}/runs"
    input_parts = _build_input(content, history)

    # Try streaming first
    try:
        return await _call_run_streaming(
            url, acp_agent_name, input_parts, room, display_name,
            stream_id, redis_client, orchestrator_id,
        )
    except Exception as e:
        logger.warning(f"acp_caller: streaming failed, falling back to sync: {e}")

    # Sync fallback
    return await _call_run_sync(
        url, acp_agent_name, input_parts, room, display_name,
        stream_id, redis_client, orchestrator_id,
    )


async def _call_run_streaming(
    url: str,
    acp_agent_name: str,
    input_parts: list,
    room: str,
    display_name: str,
    stream_id: str,
    redis_client,
    orchestrator_id: str,
) -> tuple[str, dict]:
    payload = {
        "agent_name": acp_agent_name,
        "input": input_parts,
        "stream": True,
    }

    accumulated = ""
    usage = {}

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, json=payload, headers={"Content-Type": "application/json"}) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    break
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type", "")

                if event_type == "message":
                    message = event.get("message") or {}
                    chunk = _extract_text(message.get("parts") or [])
                    if chunk:
                        accumulated += chunk
                        await redis_client.publish(
                            pubsub.chat_channel(orchestrator_id, room),
                            json.dumps({
                                "type": "stream_chunk",
                                "stream_id": stream_id,
                                "sender_name": display_name,
                                "full_text": accumulated,
                            }),
                        )

                elif event_type == "run":
                    # Final run status event — may contain usage metadata
                    run_data = event.get("run") or {}
                    usage = (run_data.get("metadata") or {}).get("usage") or {}

    return accumulated, usage


async def _call_run_sync(
    url: str,
    acp_agent_name: str,
    input_parts: list,
    room: str,
    display_name: str,
    stream_id: str,
    redis_client,
    orchestrator_id: str,
) -> tuple[str, dict]:
    payload = {
        "agent_name": acp_agent_name,
        "input": input_parts,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
        resp.raise_for_status()
        data = resp.json()

    output = data.get("output") or []
    full_text = "".join(_extract_text(item.get("parts") or []) for item in output if isinstance(item, dict))
    usage = (data.get("metadata") or {}).get("usage") or {}

    # Publish word-by-word for live typing UX
    await _publish_words(full_text, display_name, room, stream_id, redis_client, orchestrator_id)

    return full_text, usage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_input(content: str, history: list[dict] | None) -> list:
    """Build ACP input array. History is prepended as a context block."""
    parts = []

    if history:
        history_lines = []
        for turn in history:
            role = "User" if turn["role"] == "user" else "Assistant"
            history_lines.append(f"{role}: {turn['content']}")
        context = "\n".join(history_lines)
        parts.append({"text": f"[Prior conversation]\n{context}\n[End prior conversation]\n\n"})

    parts.append({"text": content})
    return [{"parts": parts}]


def _extract_text(parts: list) -> str:
    return "".join(p.get("text", "") for p in parts if isinstance(p, dict) and p.get("type", "text") == "text")


_publish_words = BaseAgentCaller.publish_words


async def ping_acp_endpoint(endpoint_url: str) -> bool:
    """Check if an ACP endpoint is reachable by calling GET /agents."""
    try:
        url = f"{endpoint_url.rstrip('/')}/agents"
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            return resp.status_code < 500
    except Exception:
        return False
