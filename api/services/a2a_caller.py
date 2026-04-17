"""
A2A Caller — Agent-to-Agent protocol client (A2A SDK 0.3.x).

Supports:
- Agent Card discovery:  GET {endpoint}/.well-known/agent-card.json
                         (falls back to /.well-known/agent.json)
- Streaming:             POST {endpoint}  message/stream  (SSE)
- Non-streaming:         POST {endpoint}  message/send    (JSON-RPC 2.0)

Returns (full_text, meta, stream_id, final_state) where final_state is one of:
  "completed" | "failed" | "working" | "unknown"
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


class A2ACaller(BaseAgentCaller):
    """A2A protocol implementation — JSON-RPC 2.0 + SSE streaming."""

    @classmethod
    async def fetch_card(cls, endpoint_url: str) -> AgentCardResponse | None:
        return await fetch_agent_card(endpoint_url)

    @classmethod
    async def ping(cls, endpoint_url: str) -> bool:
        return await ping_a2a_endpoint(endpoint_url)

# A2A task states
STATE_COMPLETED = "completed"
STATE_FAILED = "failed"
STATE_WORKING = "working"
STATE_UNKNOWN = "unknown"


# ---------------------------------------------------------------------------
# Agent Card discovery
# ---------------------------------------------------------------------------

async def fetch_agent_card(endpoint_url: str) -> AgentCardResponse | None:
    """Fetch and parse the A2A Agent Card.

    Tries /.well-known/agent-card.json first (A2A SDK 0.3.x),
    falls back to /.well-known/agent.json (legacy).
    """
    base = endpoint_url.rstrip("/")
    urls = [
        f"{base}/.well-known/agent-card.json",
        f"{base}/.well-known/agent.json",
    ]
    raw = None
    for url in urls:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    raw = resp.json()
                    break
        except Exception as e:
            logger.warning(f"a2a_caller: failed to fetch agent card from {url}: {e}")

    if not raw:
        return None

    raw_skills = raw.get("skills") or []
    skills = [s.get("name") or s.get("id") or "" for s in raw_skills if isinstance(s, dict)]
    skills = [s for s in skills if s]

    model = (raw.get("metadata") or {}).get("model", "") or ""
    capabilities = raw.get("capabilities") or {}
    streaming = bool(capabilities.get("streaming", False))

    return AgentCardResponse(
        name=raw.get("name", ""),
        description=raw.get("description", ""),
        skills=skills,
        model=model,
        streaming=streaming,
        raw=raw,
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def call_a2a(
    agent,
    content: str,
    room: str,
    redis_client,
    history: list[dict] | None = None,
    orchestrator_id: str = "",
    hunt_task_id: str = "",
    attachments: list[dict] | None = None,
) -> tuple[str, dict, str, str]:
    """
    Send a task to an A2A agent via message/stream (streaming) or message/send.

    Returns (full_text, meta, stream_id, final_state).
    final_state: "completed" | "failed" | "working" | "unknown"
    """
    endpoint_url = agent.endpoint_url.rstrip("/")
    bearer_token = agent.bearer_token or ""
    stream_id = str(uuid.uuid4())[:8]
    start_ts = datetime.utcnow()

    soul = agent.soul or {}
    supports_streaming = soul.get("a2a_streaming", True)

    headers = {"Content-Type": "application/json"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    full_text = ""
    usage = {}
    final_state = STATE_UNKNOWN

    tool_calls: list[dict] = []
    if supports_streaming:
        full_text, usage, final_state, tool_calls = await _call_stream(
            endpoint_url, content, room, agent.name,
            stream_id, redis_client, history, orchestrator_id, headers,
            attachments=attachments,
        )
    else:
        full_text, usage, final_state = await _call_send(
            endpoint_url, content, room, agent.name,
            stream_id, redis_client, history, orchestrator_id, headers,
            attachments=attachments,
        )

    meta = BaseAgentCaller.build_meta(usage, start_ts, soul)
    meta["tool_calls"] = tool_calls
    return full_text, meta, stream_id, final_state


# ---------------------------------------------------------------------------
# Streaming: message/stream (SSE)
# ---------------------------------------------------------------------------

async def _call_stream(
    endpoint_url: str,
    content: str,
    room: str,
    agent_name: str,
    stream_id: str,
    redis_client,
    history: list[dict] | None,
    orchestrator_id: str,
    headers: dict,
    attachments: list[dict] | None = None,
) -> tuple[str, dict, str]:
    payload = _build_jsonrpc("message/stream", {
        "message": _build_message(content, history, attachments),
    })

    accumulated = ""
    usage = {}
    final_state = STATE_UNKNOWN
    tool_calls: list[dict] = []

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream("POST", endpoint_url, json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    result = event.get("result") or {}
                    logger.warning(f"a2a_caller artifact raw: {json.dumps(result)[:500]}")

                    # Artifact update — text chunk or tool call event
                    artifact = result.get("artifact")
                    if artifact:
                        # Check for tool_call data parts first
                        tool_call_name = _extract_tool_call_from_artifact(artifact)
                        if tool_call_name:
                            tool_calls.append({"name": tool_call_name, "preview": ""})
                            await redis_client.publish(
                                pubsub.chat_channel(orchestrator_id, room),
                                json.dumps({
                                    "type": "tool_step",
                                    "stream_id": stream_id,
                                    "sender_name": agent_name,
                                    "tool_name": tool_call_name,
                                    "preview": "",
                                }),
                            )
                        else:
                            chunk = _extract_text_from_artifact(artifact)
                            if chunk:
                                if artifact.get("append", False):
                                    accumulated += chunk
                                else:
                                    accumulated = chunk
                                await redis_client.publish(
                                    pubsub.chat_channel(orchestrator_id, room),
                                    json.dumps({
                                        "type": "stream_chunk",
                                        "stream_id": stream_id,
                                        "sender_name": agent_name,
                                        "full_text": accumulated,
                                    }),
                                )

                    # Status update
                    status = result.get("status") or {}
                    state = status.get("state", "")
                    if state in (STATE_COMPLETED, STATE_FAILED):
                        final_state = state
                        usage = (result.get("metadata") or {}).get("usage") or {}

        return accumulated, usage, final_state, tool_calls

    except Exception as e:
        logger.warning(f"a2a_caller: streaming failed, falling back to message/send: {e}")
        text, usage, state = await _call_send(
            endpoint_url, content, room, agent_name,
            stream_id, redis_client, history, orchestrator_id, headers,
        )
        return text, usage, state, []


# ---------------------------------------------------------------------------
# Non-streaming: message/send
# ---------------------------------------------------------------------------

async def _call_send(
    endpoint_url: str,
    content: str,
    room: str,
    agent_name: str,
    stream_id: str,
    redis_client,
    history: list[dict] | None,
    orchestrator_id: str,
    headers: dict,
    attachments: list[dict] | None = None,
) -> tuple[str, dict, str]:
    payload = _build_jsonrpc("message/send", {
        "message": _build_message(content, history, attachments),
    })

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            resp = await client.post(endpoint_url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(f"a2a_caller: message/send failed: {e}")
        return "", {}, STATE_UNKNOWN

    if "error" in data:
        logger.warning(f"a2a_caller: A2A error response: {data['error']}")
        return "", {}, STATE_FAILED

    task = data.get("result") or {}
    full_text = _extract_text_from_task(task)
    usage = (task.get("metadata") or {}).get("usage") or {}
    status = (task.get("status") or {}).get("state", STATE_COMPLETED)
    final_state = status if status in (STATE_COMPLETED, STATE_FAILED) else STATE_COMPLETED

    await _publish_words(full_text, agent_name, room, stream_id, redis_client, orchestrator_id)

    return full_text, usage, final_state


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_jsonrpc(method: str, params: dict) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": method,
        "params": params,
    }


def _build_message(content: str, history: list[dict] | None, attachments: list[dict] | None = None) -> dict:
    parts = []
    if history:
        history_lines = []
        for turn in history:
            role = "User" if turn["role"] == "user" else "Assistant"
            history_lines.append(f"{role}: {turn['content']}")
        context = "\n".join(history_lines)
        parts.append({"type": "text", "text": f"[Prior conversation]\n{context}\n[End prior conversation]\n\n"})
    parts.append({"type": "text", "text": content})
    for att in (attachments or []):
        mime = att.get("type", "application/octet-stream")
        b64 = att.get("base64", "")
        name = att.get("name", "file")
        if mime.startswith("image/"):
            parts.append({
                "kind": "file",
                "file": {"name": name, "mimeType": mime, "bytes": b64},
            })
        else:
            import base64 as _b64
            try:
                text_content = _b64.b64decode(b64).decode("utf-8", errors="replace")
            except Exception:
                text_content = b64
            parts.append({"type": "text", "text": f"\n[Attachment: {name}]\n{text_content}"})
    return {
        "messageId": str(uuid.uuid4()),
        "role": "user",
        "parts": parts,
    }


def _extract_text_from_task(task: dict) -> str:
    artifacts = task.get("artifacts") or []
    return "".join(_extract_text_from_artifact(a) for a in artifacts)


def _extract_text_from_artifact(artifact: dict) -> str:
    parts = artifact.get("parts") or []
    # A2A SDK 0.3.x uses "kind" instead of "type"
    return "".join(
        p.get("text", "")
        for p in parts
        if p.get("kind") == "text" or p.get("type") == "text"
    )


def _extract_tool_call_from_artifact(artifact: dict) -> str:
    """Return tool name if artifact is a tool_call data part, else empty string."""
    parts = artifact.get("parts") or []
    for p in parts:
        if p.get("kind") == "data":
            data = p.get("data") or {}
            if data.get("type") == "tool_call":
                return data.get("name", "")
    return ""


_publish_words = BaseAgentCaller.publish_words


async def ping_a2a_endpoint(endpoint_url: str, bearer_token: str | None = None) -> bool:
    base = endpoint_url.rstrip("/")
    headers: dict[str, str] = {}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    for path in ["/.well-known/agent-card.json", "/.well-known/agent.json"]:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(f"{base}{path}", headers=headers)
                if resp.status_code < 500:
                    return True
        except Exception:
            continue
    return False
