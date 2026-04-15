"""
Akela Bridge — in-memory SSE connection store for remote agents.

Remote agents connect outbound via akela-adapter:
    akela-adapter --api-key akela_xxx

The adapter maintains an SSE connection to GET /chat/subscribe/agent.
When a task is dispatched, Akela pushes it over this SSE stream.
The adapter runs the LLM and POSTs the result to POST /chat/agent-message.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional


@dataclass
class BridgeConnection:
    agent_id: str
    agent_name: str
    send: Callable[[str, dict], None]   # (event, data) → writes SSE
    close: Callable[[], None]
    pending: Dict[str, asyncio.Future] = field(default_factory=dict)


class AkelaBridge:
    def __init__(self):
        self._connections: Dict[str, BridgeConnection] = {}   # api_key → conn
        self._by_agent_id: Dict[str, str] = {}               # agent_id → api_key

    def register(self, api_key: str, conn: BridgeConnection):
        self._connections[api_key] = conn
        self._by_agent_id[conn.agent_id] = api_key

    def remove(self, api_key: str):
        conn = self._connections.pop(api_key, None)
        if conn:
            self._by_agent_id.pop(conn.agent_id, None)

    def is_connected(self, api_key: str) -> bool:
        return api_key in self._connections

    def is_agent_connected(self, agent_id: str) -> bool:
        key = self._by_agent_id.get(agent_id)
        return key is not None and key in self._connections

    def get_by_agent_id(self, agent_id: str) -> Optional[BridgeConnection]:
        key = self._by_agent_id.get(agent_id)
        return self._connections.get(key) if key else None

    async def dispatch_task(self, agent_id: str, task_id: str, prompt: str, timeout: int = 300) -> Optional[str]:
        """Push a task to a connected remote agent and wait for the response."""
        conn = self.get_by_agent_id(agent_id)
        if not conn:
            return None
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        conn.pending[task_id] = fut
        conn.send("task", {"task_id": task_id, "prompt": prompt})
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            conn.pending.pop(task_id, None)
            return None

    def receive_response(self, api_key: str, task_id: str, content: str) -> bool:
        conn = self._connections.get(api_key)
        if not conn:
            return False
        fut = conn.pending.pop(task_id, None)
        if fut and not fut.done():
            fut.set_result(content)
            return True
        return False


bridge = AkelaBridge()
