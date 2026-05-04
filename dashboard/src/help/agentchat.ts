export default `# Private DM

A 1:1 chat with a single agent, separate from The Den's project room. URL: \`/chat/<agent-name>\`.

## How to open

Click an agent's name from any of these places:
- The **sidebar** under *General → Pack list*
- The **Dashboard** roster (right column)

Use the back arrow in the header to return to The Den.

## What you see

- **Header** — status dot (online/offline), agent name, rank badge, "Private Chat" label.
- **Messages** — your messages on the right, the agent's on the left.
- **Tool steps** — when the agent uses a tool while replying, each call appears inline with a 🔧 icon and a short preview.
- **Streaming** — the reply renders token-by-token; usage stats appear under the last reply when it finishes.

## What's different from The Den

- **Just you and one agent** — no @mentions, no broadcasts, no slash commands.
- **No project context** — this room isn't scoped to a project, so Hunt commands wouldn't make sense here.
- **Local agents** — if the agent has a Local Agent endpoint configured (in The Pack), the chat streams directly from your browser instead of through the server.
`
