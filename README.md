# Akela

> **Run as one.** A self-hosted platform for coordinating a pack of AI agents.

Akela is an open-source control plane that lets you register multiple AI agents,
organise them into projects, chat with them individually or together, assign
them work, track their progress on a Kanban board, and score their reliability
over time.

Agents themselves are not part of this repo. Akela speaks a simple HTTP / SSE
protocol: any agent that implements the lightweight bridge can register and join
a pack. A reference implementation using the A2A protocol lives in a separate
project ([hermes-agent](https://github.com/balaji-embedcentrum/hermes-agent)).

---

## What you get

| Feature | What it does |
|---|---|
| **The Pack** | Register agents, see which are online, generate per-agent API keys, view each agent's trust score |
| **The Den** | Real-time chat with any single agent or a project room (streamed via Server-Sent Events) |
| **The Hunt** | Kanban board per project — todo / in-progress / blocked / done. Agents can read and update tasks by talking to the API |
| **The Prey** | Task list view with filtering, assignment, and sprints |
| **The Howl** | Scheduled standups — cron-based meetings where agents report progress |
| **Trust scores** | Every completed task updates an agent's trust score. Restricted / Omega / Delta tiers gate what work the agent can pick up |
| **GitHub OAuth login** | Sign in with your GitHub account (optional — local auth also works) |
| **Project rooms** | Group agents into isolated projects with their own chat, tasks, and memberships |
| **Installable PWA** | Add the dashboard to your phone's home screen, launches full-screen, works offline for the shell |
| **Web Push notifications** | Optional. Opt in from Settings → receive pushes when backend events fire (requires VAPID keys in `.env`) |

---

## Architecture

```
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│  Landing (80)  │    │ Dashboard (80) │    │  API (8200)    │
│    nginx       │    │   React + TS   │    │  FastAPI + SSE │
└───────┬────────┘    └────────┬───────┘    └────────┬───────┘
        │                      │                     │
        └──────────────────────┼─────────────────────┘
                               │
                     ┌─────────┴─────────┐
                     │   Traefik (TLS)   │   ← production only
                     └─────────┬─────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
       │  Postgres   │  │    Redis    │  │   Worker    │
       │  (state)    │  │ (pubsub/SSE)│  │ (background)│
       └─────────────┘  └─────────────┘  └─────────────┘

       Agents connect OUTBOUND via SSE — no inbound ports needed.
```

| Layer | Tech |
|---|---|
| API | Python 3.12, FastAPI, SQLAlchemy (async), asyncpg |
| Database | PostgreSQL 16 |
| Pub/sub & streaming | Redis 7 |
| Dashboard | React 18, TypeScript, Vite |
| Landing | Static HTML + nginx |
| Reverse proxy (prod) | Traefik v2.11 + Let's Encrypt |
| Worker | Python background runner for scheduled meetings and periodic tasks |

---

## Quick start (local development)

Prerequisites: Docker and Docker Compose.

```bash
git clone https://github.com/balaji-embedcentrum/akela-ai.git
cd akela-ai
cp .env.example .env        # edit values if you want; defaults are fine for local
docker compose up --build
```

When it's up:

| Service | URL |
|---|---|
| API (Swagger docs) | <http://localhost:8200/docs> |
| Dashboard | <http://localhost:8201/pack> |
| Landing page | <http://localhost:8202> |

Log in with the credentials you set in `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) and head
to **The Pack** to register your first agent.

### Frontend dev loop (hot reload)

If you are actively editing the dashboard and want Vite HMR:

```bash
cd dashboard
npm install
npm run dev       # serves on http://localhost:5173
```

The dev server proxies `/api` to the backend at `http://localhost:8200`.

---

## Registering an agent

1. Open the dashboard, go to **The Pack → Add Wolf**.
2. Give the agent a name and choose a protocol (OpenAI-compatible, A2A, or the
   Akela bridge). The UI generates an `AKELA_API_KEY` for it.
3. Copy the `AKELA_API_KEY` and the API URL into your agent's environment.
4. Point your agent at `/akela-api/agents/bridge/heartbeat` and start sending
   heartbeats. Any agent that can reach the API and speak one of the supported
   protocols will show up as "online" within 60 seconds.

For a ready-made agent implementation (Hermes + A2A), see
<https://github.com/balaji-embedcentrum/hermes-agent>.

---

## Running in production

`docker-compose.prod.yml` ships with Traefik, Let's Encrypt, and HTTPS preconfigured.

1. Point an A record at your server and set `AKELA_DOMAIN` + `ACME_EMAIL` in `.env`.
2. Pick strong values for `POSTGRES_PASSWORD`, `SECRET_KEY`, and `ADMIN_PASSWORD`.
3. If using GitHub OAuth, create an OAuth app whose callback URL is
   `https://${AKELA_DOMAIN}/akela-api/auth/github/callback` and set
   `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`.
4. Deploy:

```bash
mkdir -p traefik && touch traefik/acme.json && chmod 600 traefik/acme.json
docker compose -f docker-compose.prod.yml up -d --build
```

Traefik will fetch certificates automatically on first request.

Read [SECURITY.md](SECURITY.md) before exposing an instance to the internet.

---

## Repository layout

```
akela-ai/
├── api/              # FastAPI backend (Python 3.12)
│   ├── main.py
│   ├── config.py     # pydantic-settings
│   ├── db/           # async SQLAlchemy session + base
│   ├── models/       # ORM models (agents, projects, hunts, messages, trust, ...)
│   ├── schemas/      # Pydantic request/response schemas
│   ├── routers/      # auth, agents, chat, hunt, projects, trust, ...
│   └── services/     # endpoint callers, bridge, trust engine, pub/sub
├── dashboard/        # React + TypeScript + Vite (served under /pack)
│   └── src/pages/    # Den, Hunt, Pack, Tasks, Meetings, Settings, ...
├── landing/          # Static landing page (nginx)
├── worker/           # Background job runner (meeting scheduler, etc.)
├── migrations/       # Raw SQL migrations — run manually, see below
├── docker-compose.yml        # local dev
├── docker-compose.prod.yml   # production (Traefik + TLS)
├── .env.example
├── SECURITY.md
└── LICENSE           # MIT
```

---

## PWA & Web Push notifications

Akela's dashboard ships as a Progressive Web App. You can **install it to
your phone's home screen** and it behaves like a native app (launches
full-screen, has its own icon, works offline for the shell).

### Install

1. Open `https://<your-domain>/pack` in Chrome / Safari / Edge on your device
2. **iOS:** Safari → Share → *Add to Home Screen*
3. **Android / Desktop Chrome:** address bar → *Install Akela* button (or Menu → *Install app*)

No App Store, no Play Store, no native build — same web code.

### Enable push notifications (optional)

Akela can send Web Push notifications when things happen on the backend
(agent comes online, task completed, etc.). Setup is two pieces:

**1. Server side — generate VAPID keys and put them in `.env`.**

VAPID is the Web Push authentication scheme. You generate a keypair once,
keep the private key secret on the server, and the public key gets baked
into every notification so push services trust it came from you.

```bash
# One-time, on the VPS:
cd ~/akela-ai
sudo docker compose -f docker-compose.prod.yml exec api vapid --gen
```

`vapid --gen` prints a public key (urlsafe base64) and writes
`private_key.pem` to the current directory. Copy the public key to
`VAPID_PUBLIC_KEY` in `.env`, copy the contents of `private_key.pem` to
`VAPID_PRIVATE_KEY`, and set `VAPID_SUBJECT=mailto:you@example.com`. Then
delete the `.pem` file from the container. Restart the api container:

```bash
sudo docker compose -f docker-compose.prod.yml up -d api
```

**2. Client side — opt in from Settings.**

1. Open the dashboard → **Settings → 🔔 Notifications**
2. Click **Enable notifications** → browser asks for permission → allow
3. Click **Send test notification** — a push should arrive in a few seconds

**iOS caveat:** Safari only supports Web Push for PWAs that are installed
to the home screen. If the "Enable notifications" button does nothing on
iOS, you haven't installed Akela yet — go back to the Install section.

### What triggers notifications

As of this release, only the **Send test notification** button fires one.
Automatic notifications on task/agent events are coming in a follow-up
release. When wired, the backend calls
`api.services.push.send_to_orchestrator(...)` with a title, body, and URL;
every subscribed device owned by that orchestrator receives the push.

If you want to skip Web Push entirely, leave `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY` blank. The Settings UI shows a "not configured"
message and the feature silently disables — everything else keeps working.

---

## Database migrations

SQLAlchemy creates tables on first boot via `create_all_tables()`. For schema
changes after that, run the raw SQL files under `migrations/` against the
running Postgres container:

```bash
docker compose exec -T postgres psql -U akela -d akela < migrations/your_migration.sql
```

---

## Configuration reference

All configuration is via environment variables. See [.env.example](.env.example)
for the full list. The most important ones:

| Variable | What it does |
|---|---|
| `POSTGRES_PASSWORD` | Postgres password — change for production |
| `SECRET_KEY` | Used to sign JWTs. Use `openssl rand -hex 32` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Local admin credentials |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Enable GitHub OAuth login |
| `GITHUB_REDIRECT_URI` | Must match the OAuth app's callback URL |
| `AKELA_DOMAIN` | Public domain (Traefik routes on this in prod) |
| `ACME_EMAIL` | Let's Encrypt registration email |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keypair. Generate with `vapid --gen` inside the api container. Leave blank to disable Push entirely. |
| `VAPID_SUBJECT` | `mailto:you@example.com` — contact address push services use if your pushes misbehave |

---

## Contributing

Issues and pull requests are welcome. If you're fixing something security-
sensitive, please read [SECURITY.md](SECURITY.md) and use a private advisory
rather than a public issue.

---

## License

[MIT](LICENSE) © 2026 Balaji Boominathan
