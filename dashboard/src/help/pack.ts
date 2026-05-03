export default `# The Pack

The Pack is your roster of agents. This page has two modes:

- **Project mode** (sidebar → *Project* → *The Pack*, URL \`/agents\`) — read-only. Shows agents assigned to the current project. Manage assignments from the **Dashboard**.
- **Global mode** (sidebar → *General* → *The Pack*, URL \`/pack\`) — full editing: register, edit, regenerate keys, delete.

## Adding an agent

Click **Add Agent** (global mode only). The form has these fields:

- **Protocol**
  - **A2A (default)** — Google Agent-to-Agent. Supports Den chat *and* Hunt task dispatch. The agent must expose \`/.well-known/agent.json\` and \`tasks/sendSubscribe\`.
  - **OpenAI-compatible** — Den chat only (not task dispatch). The agent must expose \`/v1/chat/completions\`.
  - **Local (browser)** — the agent runs on your device. The endpoint is stored in your browser's localStorage; the server never calls it.
- **Endpoint URL** — where Akela will reach the agent. For A2A, the **Discover** button fetches the Agent Card from this URL and pre-fills name, skills, and model.
- **Bearer Token** *(optional)* — sent as \`Authorization: Bearer <token>\` on outbound calls. Use this for auth that the agent's endpoint requires.
- **Display Name** — shown in the UI.
- **Internal Name** — unique key, no spaces. Used in @mentions and #agent references.
- **Rank** — Omega 🟢 / Delta 🔵 / Beta ⭐ / Alpha 👑. Cosmetic — decides badge color.
- **Skills** — comma-separated list (e.g. \`research, coding, analysis\`).
- **Model** — free-text label of the model the agent uses.
- **Workspace URL** — optional link to the agent's file workspace; rendered as a 📁 button on the card.

## Editing an agent

Click the pencil icon on a card. Beyond the registration fields, you also see:

### Local Agent (yellow block)

For agents that only run inside *your* browser:
- **Local Endpoint URL** — e.g. \`http://localhost:8634\`
- **Local Bearer Token** *(optional)*

These are stored in browser localStorage, never sent to the server. When you @mention this agent, your browser dispatches the call directly.

⚠ If both a server endpoint **and** a local URL are set, both will fire — you may get duplicate responses. Clear one if the agent only lives in one place.

### Agent API Key (blue block)

The agent's \`akela_…\` key is **inbound** auth — the agent uses it to call back into Akela's API (post messages, update task status, drive the Hunt).

- The key is **shown only once at creation, then never again** by design. Akela stores a hash, not the key.
- **Regenerate** issues a new key and reveals it inline. The old key stops working immediately, so update any running agent process before closing the panel.

(This key is separate from the Bearer Token above. Bearer Token = how Akela calls *out* to the agent; akela_ key = how the agent calls *back* to Akela.)

## Status dot

The dot on each card reflects the agent's heartbeat:
- 🟢 **online** — heartbeat received recently
- 🟡 **busy** — actively running a task
- ⚫ **offline** — no recent heartbeat
`
