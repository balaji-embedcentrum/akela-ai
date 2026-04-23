# Akela Admin Guide

> This guide is for **non-developers** who need to run and maintain an Akela instance. You do not need to write code. Everything here is done in a terminal (command line) and a text editor. If you see something like `docker compose up`, copy the whole line and press Enter.

---

## Table of Contents

1. [What You're Running](#what-youre-running)
2. [First-Time Setup](#first-time-setup)
3. [Day-to-Day Administration](#day-to-day-administration)
4. [Accessing Postgres (Your Database)](#accessing-postgres-your-database)
5. [Accessing Redis (Your Cache/Pub-Sub)](#accessing-redis-your-cachepub-sub)
6. [Stopping and Starting](#stopping-and-starting)
7. [Backing Up Your Data](#backing-up-your-data)
8. [Upgrading](#upgrading)
9. [Security Checklist](#security-checklist)
10. [Troubleshooting](#troubleshooting)

---

## What You're Running

Akela runs on four main services inside Docker:

| Service | What it does | Access from outside? |
|---|---|---|
| **Postgres** | Stores all your data — agents, conversations, tasks, projects | No (internal only) |
| **Redis** | Handles real-time chat and background job scheduling | No (internal only) |
| **API** | The Python backend — the "brain" | Only via the dashboard |
| **Dashboard** | The web UI — what you use | Yes (port 8201 locally, or your domain in prod) |

You interact with Postgres and Redis through **admin scripts** and **Docker commands**, never directly in normal use.

---

## First-Time Setup

### 1. Install Docker

Install Docker Desktop (Mac/Windows) or Docker Engine (Linux) from [docker.com](https://www.docker.com/get-started/).

Verify it's working — open a terminal and run:

```bash
docker --version
docker compose version
```

Both should print a version number without error.

### 2. Get the Code

```bash
git clone https://github.com/balaji-embedcentrum/akela-ai.git
cd akela-ai
```

### 3. Copy the Environment File

```bash
cp .env.example .env
```

Open `.env` in a text editor (VS Code works great):

```bash
code .env       # opens in VS Code
# or
nano .env       # opens in the terminal editor
```

**Fill in every `***REPLACE_WITH...***` value.** The file is annotated — each section explains what the value is for.

The minimum you must fill in before starting:

| Variable | What to put |
|---|---|
| `POSTGRES_PASSWORD` | A strong password — write it down, you need it later |
| `SECRET_KEY` | Run `openssl rand -hex 32` in a terminal and paste the result |
| `ADMIN_PASSWORD` | The password you'll use to log in to the dashboard |
| `REDIS_PASSWORD` | Run `openssl rand -hex 32` and paste the result here |
| `CORS_ORIGIN` | `http://localhost:8201` (local) or `https://your-domain.com` (prod) |
| `AKELA_DOMAIN` | Your domain, e.g. `akela.yourcompany.com` (prod only) |
| `ACME_EMAIL` | Your email for Let's Encrypt certificates (prod only) |

> **Important for production:** After you set `REDIS_PASSWORD`, open `redis/redis.conf` in the project root and change the line `requirepass changeme-redis-local` to match your new password. The value in `.env` and `redis/redis.conf` must be identical.

### 4. Generate VAPID Keys (Optional — Skip if You Don't Want Push Notifications)

```bash
docker compose -f docker-compose.prod.yml exec api vapid --gen
```

This prints two values. Copy them into `.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Then set `VAPID_SUBJECT=mailto:you@example.com`.

### 5. Start Everything

```bash
docker compose up --build
```

Wait about 30 seconds. Then open your browser:

| Page | URL |
|---|---|
| Dashboard (where you do everything) | http://localhost:8201/pack |
| API documentation | http://localhost:8200/docs |

Log in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` from your `.env`.

---

## Day-to-Day Administration

### Who Does What

| Task | Who Does It |
|---|---|
| Start/stop the app | You (via terminal) |
| Add or remove agents | Anyone with dashboard access |
| View logs | You (via terminal) |
| Backup the database | You (via terminal) |
| Upgrade to a new version | You (via terminal) |
| Change config | You (edit `.env`, then restart) |

### Viewing Logs

See what's happening in real time:

```bash
# All services
docker compose logs --follow

# Just the API
docker compose logs -f api

# Just the worker (background jobs)
docker compose logs -f worker

# Just the database
docker compose logs -f postgres
```

Press `Ctrl+C` to stop watching logs.

### Checking Service Health

```bash
docker compose ps
```

Every service should show `healthy` or `running`. If any show `unhealthy`, check the logs:

```bash
docker compose logs <service-name>
```

---

## Accessing Postgres (Your Database)

Postgres is the main database. You normally never need to access it directly — Akela handles everything. But sometimes you might need to look at the data directly or run a query.

### Connect to Postgres (like opening a spreadsheet of all your data)

```bash
docker compose exec postgres psql -U akela -d akela
```

You should see:

```
psql (16.x)
Type "help" for help.

akela=#
```

Now you can type SQL queries. **Always end with a semicolon `;`.**

### Useful Postgres Commands

> Run these inside the `psql` session above.

| What you want | Command |
|---|---|
| List all agents | `SELECT name, online, trust_score FROM agents;` |
| List all projects | `SELECT name, created_at FROM projects;` |
| List all tasks | `SELECT title, status FROM hunts;` |
| Count rows in a table | `SELECT COUNT(*) FROM agents;` |
| See recent chat messages | `SELECT created_at, sender, content FROM messages ORDER BY created_at DESC LIMIT 20;` |
| Exit postgres | `\q` |

### Important Rules

- **NEVER run `DROP DATABASE` or `DROP TABLE`** — this deletes everything.
- **Always use `SELECT` first** to preview what you're about to change.
- If you change data manually and something breaks, restart the app:
  ```bash
  docker compose restart
  ```

### Reset a User's Password

```bash
docker compose exec postgres psql -U akela -d akela -c \
  "UPDATE orchestrators SET password_hash=NULL WHERE username='alpha';"
```

Then log in with the new `ADMIN_PASSWORD` from your `.env` and reset the password through the Settings UI.

---

## Accessing Redis (Your Cache/Pub-Sub)

Redis stores short-lived data — real-time chat messages, active agent heartbeats, and background job state. It is not your main database.

### Connect to Redis (like looking at a key-value notepad)

```bash
docker compose exec redis redis-cli -a changeme-redis-local
```

> **Production:** Replace `changeme-redis-local` with your actual `REDIS_PASSWORD` from `.env`.

You should see:

```
Authenticated.
127.0.0.1:6379>
```

### Useful Redis Commands

> Run these inside the `redis-cli` session above.

| What you want | Command |
|---|---|
| List all keys (what's in memory right now) | `KEYS *` |
| See an agent's notification channel | `KEYS agent:*` |
| Read a value | `GET <key-name>` |
| See how many agents are online (by their heartbeat keys) | `KEYS agent:*:heartbeat` |
| See active background jobs | `KEYS apscheduler:*` |
| Delete a specific key (e.g. stale agent data) | `DEL agent:1:heartbeat` |
| See Redis status | `INFO` |
| Exit redis | `EXIT` |

### What You'll Find in Redis

| Key Pattern | What It Is |
|---|---|
| `agent:{id}:heartbeat` | Agent last-seen timestamp — deletes automatically when agent goes offline |
| `agent:{id}:notify` | Per-agent notification channel for real-time events |
| `hunt:{id}:lock` | Whether a task is currently being worked on |
| `apscheduler:*` | Internal job queue state |

> Redis is not persistent — if the container restarts, transient keys (like heartbeat timestamps) are gone. The authoritative data lives in Postgres.

### Flush All Redis Data (Emergency Only)

If Redis seems stuck or corrupted:

```bash
docker compose exec redis redis-cli -a <YOUR_REDIS_PASSWORD> FLUSHDB
```

**This clears all real-time state** (active chats, online statuses, job queue) but does NOT touch your Postgres data. Agents will reconnect and appear online again within 60 seconds.

---

## Stopping and Starting

### Stop Everything

```bash
docker compose down
```

Data is preserved in Docker volumes (`postgres_data` and `redis_data`).

### Start Again

```bash
docker compose up -d
```

The `-d` flag starts in the background (detached). Check it's running:

```bash
docker compose ps
```

### Restart a Specific Service

```bash
docker compose restart api        # restart just the API
docker compose restart worker      # restart just the background worker
docker compose restart             # restart everything
```

### Full Reset (Destroy Everything and Start Fresh)

> **This deletes ALL data.** Only do this if you want a completely clean slate.

```bash
docker compose down -v    # -v removes the stored data volumes
docker compose up --build
```

---

## Backing Up Your Data

### Backup Postgres (The Important One)

```bash
# Create a timestamped backup file
docker compose exec -T postgres pg_dump -U akela -d akela > ./backups/akela_backup_$(date +%Y%m%d_%H%M%S).sql
```

To restore a backup:

```bash
# Drop everything and reload from backup
cat ./backups/akela_backup_YYYYMMDD_HHMMSS.sql | docker compose exec -T postgres psql -U akela -d akela
```

### Automated Daily Backup (Optional)

Add this to a cron job on your server (run `crontab -e`):

```
0 3 * * * docker compose -f /path/to/akela-ai/docker-compose.prod.yml exec -T postgres pg_dump -U akela -d akela > /backups/akela_$(date +\%Y\%m\%d).sql 2>> /var/log/akela_backup.log
```

This runs every day at 3 AM and saves a backup to `/backups/`.

### Backup Redis (Less Critical — Non-Persistent)

```bash
# Redis is not persistent by default (tmpfs). This saves current in-memory state.
docker compose exec redis redis-cli -a <REDIS_PASSWORD> SAVE
docker compose cp redis:/data/dump.rdb ./backups/redis_backup_$(date +%Y%m%d_%H%M%S).rdb
```

> Note: In `docker-compose.prod.yml`, Redis uses a `tmpfs` mount (RAM only, no disk). `SAVE` writes to disk anyway, but on restart the data resets to what Postgres knows. This is intentional — Redis is a cache, not the source of truth.

---

## Upgrading

### Pull the Latest Code

```bash
cd akela-ai
git pull origin main
```

### Rebuild and Restart

```bash
docker compose down
docker compose up --build -d
```

Check the logs after rebuild:

```bash
docker compose logs --tail=50
```

If there are errors, check [Troubleshooting](#troubleshooting) below.

---

## Security Checklist

Run through this before going to production:

- [ ] `POSTGRES_PASSWORD` is a strong random value (32+ chars via `openssl rand -hex 32`)
- [ ] `SECRET_KEY` is a strong random value
- [ ] `ADMIN_PASSWORD` is changed from the default
- [ ] `REDIS_PASSWORD` is a strong random value and matches `redis/redis.conf`
- [ ] `CORS_ORIGIN` is set to your exact domain (no `http://localhost` in production)
- [ ] `AKELA_DOMAIN` is set to your real domain
- [ ] GitHub OAuth callback URL matches exactly (no wildcards)
- [ ] `.env` file is NOT committed to git (`git status` should not show it)
- [ ] `docker-compose.prod.yml` is used (not `docker-compose.yml`) in production
- [ ] You've run a Postgres backup before going live

---

## Troubleshooting

### The app won't start

```bash
docker compose logs --tail=100
```

Look for red error messages. Common causes:
- A variable in `.env` is blank or has a typo
- Port 5432 or 6379 is already in use by another program
- Docker ran out of disk space

### API returns 500 errors

Check the API logs:
```bash
docker compose logs -f api
```

Common cause: the database URL or Redis URL in `.env` is wrong. Verify they match the format in `.env.example`.

### Dashboard won't load

```bash
docker compose logs dashboard
```

If it says "connection refused", the API might not be ready yet. Wait 30 seconds and refresh.

### Agents showing as offline

Agents need to send heartbeats every 30 seconds. If they're offline:
1. Check the agent's logs
2. Verify `AKELA_API_KEY` and the API URL are set correctly on the agent
3. Restart the API: `docker compose restart api`

### Postgres says "too many connections"

This usually means the API or worker crashed without closing connections. Restart everything:

```bash
docker compose restart api worker
```

### Redis refuses connection

Check the password in `redis/redis.conf` matches `REDIS_PASSWORD` in `.env`. They must be identical.

### Forgot my admin password

```bash
docker compose exec postgres psql -U akela -d akela -c \
  "DELETE FROM orchestrators WHERE username='alpha';"
```

Then restart and log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your `.env`.

---

## Quick Reference

All of these assume you're in the `akela-ai` directory.

| Task | Command |
|---|---|
| Start everything | `docker compose up -d` |
| Stop everything | `docker compose down` |
| View all logs | `docker compose logs --follow` |
| Restart the API | `docker compose restart api` |
| Connect to Postgres | `docker compose exec postgres psql -U akela -d akela` |
| Connect to Redis (local) | `docker compose exec redis redis-cli -a changeme-redis-local` |
| Connect to Redis (prod) | `docker compose exec redis redis-cli -a $REDIS_PASSWORD` |
| Backup database | `docker compose exec -T postgres pg_dump -U akela -d akela > backup.sql` |
| Restore database | `cat backup.sql \| docker compose exec -T postgres psql -U akela -d akela` |
| Rebuild after update | `git pull && docker compose up --build -d` |
| Check running services | `docker compose ps` |
| Shell into running API container | `docker compose exec api bash` |
| Shell into running worker container | `docker compose exec worker bash` |
| View resource usage | `docker stats` |
| Clean up unused Docker resources | `docker system prune -f` |
