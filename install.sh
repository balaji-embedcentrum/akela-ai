#!/usr/bin/env bash
# ============================================================
# Akela — VPS bootstrap installer
#
# Run on a FRESH Ubuntu/Debian VPS as a sudo-capable user:
#
#   curl -fsSL https://raw.githubusercontent.com/balaji-embedcentrum/akela-ai/main/install.sh | bash
#
# or, after cloning the repo manually:
#
#   sudo bash install.sh
#
# Required env (or you'll be prompted):
#   AKELA_DOMAIN       e.g. akela.example.com  (A record must point here)
#   ACME_EMAIL         e.g. you@example.com    (for Let's Encrypt)
#
# Optional env:
#   ADMIN_USERNAME              default: alpha
#   ADMIN_PASSWORD              default: auto-generated
#   POSTGRES_PASSWORD           default: auto-generated
#   SECRET_KEY                  default: auto-generated (openssl rand -hex 32)
#   GITHUB_CLIENT_ID/SECRET     optional GitHub OAuth
#   GOOGLE_CLIENT_ID/SECRET     optional Google OAuth
#   AKELA_REPO                  default: https://github.com/balaji-embedcentrum/akela-ai.git
#   AKELA_BRANCH                default: main
#   AKELA_DIR                   default: /opt/akela-ai
# ============================================================

set -euo pipefail

# --- helpers ---------------------------------------------------------------

log()  { printf '\033[1;36m[akela]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[akela]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[akela]\033[0m %s\n' "$*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

require_root_or_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
  elif need_cmd sudo; then
    SUDO="sudo"
  else
    die "Run as root or install sudo."
  fi
}

prompt() {
  local var="$1" msg="$2" default="${3-}"
  local cur="${!var-}"
  if [ -n "$cur" ]; then return; fi
  if [ -t 0 ]; then
    if [ -n "$default" ]; then
      read -r -p "$msg [$default]: " val || true
      val="${val:-$default}"
    else
      read -r -p "$msg: " val || true
    fi
  else
    val="$default"
  fi
  printf -v "$var" '%s' "$val"
}

prompt_required() {
  local var="$1" msg="$2"
  prompt "$var" "$msg"
  if [ -z "${!var-}" ]; then
    die "$var is required (set it as an env var or run interactively)."
  fi
}

rand_hex()    { openssl rand -hex "$1"; }
rand_pass()   { openssl rand -base64 24 | tr -d '/+=' | cut -c1-24; }

# --- 0. preflight ----------------------------------------------------------

require_root_or_sudo

if ! need_cmd openssl; then
  log "Installing openssl..."
  $SUDO apt-get update -y
  $SUDO apt-get install -y openssl
fi

# --- 1. collect config -----------------------------------------------------

log "Collecting configuration..."

prompt_required AKELA_DOMAIN "Public domain for Akela (e.g. akela.example.com)"
prompt_required ACME_EMAIL   "Email for Let's Encrypt"

prompt ADMIN_USERNAME    "Admin username"           "alpha"
prompt ADMIN_PASSWORD    "Admin password (blank=auto)" ""
prompt POSTGRES_PASSWORD "Postgres password (blank=auto)" ""
prompt SECRET_KEY        "JWT secret key (blank=auto)" ""
prompt GITHUB_CLIENT_ID     "GitHub OAuth Client ID (blank=skip)" ""
prompt GITHUB_CLIENT_SECRET "GitHub OAuth Client Secret (blank=skip)" ""
prompt GOOGLE_CLIENT_ID     "Google OAuth Client ID (blank=skip)" ""
prompt GOOGLE_CLIENT_SECRET "Google OAuth Client Secret (blank=skip)" ""

ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(rand_pass)}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(rand_pass)}"
SECRET_KEY="${SECRET_KEY:-$(rand_hex 32)}"

AKELA_REPO="${AKELA_REPO:-https://github.com/balaji-embedcentrum/akela-ai.git}"
AKELA_BRANCH="${AKELA_BRANCH:-main}"
AKELA_DIR="${AKELA_DIR:-/opt/akela-ai}"

# --- 2. system packages ----------------------------------------------------

log "Updating apt and installing base packages..."
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -y
$SUDO apt-get install -y \
  ca-certificates curl git gnupg lsb-release ufw

# --- 3. docker -------------------------------------------------------------

if ! need_cmd docker; then
  log "Installing Docker Engine + Compose plugin..."
  $SUDO install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker
else
  log "Docker already installed: $(docker --version)"
fi

if [ "$(id -u)" -ne 0 ] && ! id -nG "$USER" | grep -qw docker; then
  log "Adding $USER to docker group (re-login required to take effect)..."
  $SUDO usermod -aG docker "$USER" || true
fi

# --- 4. firewall (best-effort, only if ufw is active) ----------------------

if need_cmd ufw && $SUDO ufw status | grep -q "Status: active"; then
  log "Opening 80/443 in ufw..."
  $SUDO ufw allow 80/tcp  || true
  $SUDO ufw allow 443/tcp || true
fi

# --- 5. clone or update repo ----------------------------------------------

if [ -d "$AKELA_DIR/.git" ]; then
  log "Repo already at $AKELA_DIR — fetching latest..."
  $SUDO git -C "$AKELA_DIR" fetch --all --prune
  $SUDO git -C "$AKELA_DIR" checkout "$AKELA_BRANCH"
  $SUDO git -C "$AKELA_DIR" pull --ff-only
else
  log "Cloning $AKELA_REPO into $AKELA_DIR..."
  $SUDO mkdir -p "$(dirname "$AKELA_DIR")"
  $SUDO git clone --branch "$AKELA_BRANCH" "$AKELA_REPO" "$AKELA_DIR"
fi

if [ "$(id -u)" -ne 0 ]; then
  $SUDO chown -R "$USER":"$USER" "$AKELA_DIR" || true
fi

cd "$AKELA_DIR"

# --- 6. write .env ---------------------------------------------------------

ENV_FILE="$AKELA_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  BACKUP="$ENV_FILE.bak.$(date +%s)"
  log "Existing .env found, backing up to $BACKUP"
  $SUDO cp "$ENV_FILE" "$BACKUP"
fi

log "Writing $ENV_FILE..."
$SUDO tee "$ENV_FILE" >/dev/null <<EOF
# Generated by install.sh on $(date -Iseconds)
POSTGRES_USER=akela
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

SECRET_KEY=${SECRET_KEY}
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
GITHUB_REDIRECT_URI=https://${AKELA_DOMAIN}/akela-api/auth/github/callback

GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
GOOGLE_REDIRECT_URI=https://${AKELA_DOMAIN}/akela-api/auth/google/callback

AKELA_DOMAIN=${AKELA_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:${ACME_EMAIL}
EOF
$SUDO chmod 600 "$ENV_FILE"

# --- 7. traefik acme.json --------------------------------------------------

log "Preparing traefik/acme.json..."
$SUDO mkdir -p "$AKELA_DIR/traefik"
$SUDO touch "$AKELA_DIR/traefik/acme.json"
$SUDO chmod 600 "$AKELA_DIR/traefik/acme.json"

# --- 8. build & launch -----------------------------------------------------

DC="docker compose -f docker-compose.prod.yml"
if [ "$(id -u)" -ne 0 ] && ! id -nG "$USER" | grep -qw docker; then
  DC="$SUDO $DC"
fi

log "Building images and starting the stack (this may take several minutes on first run)..."
$DC --env-file "$ENV_FILE" pull --ignore-pull-failures || true
$DC --env-file "$ENV_FILE" up -d --build

log "Waiting 10s for services to settle..."
sleep 10
$DC --env-file "$ENV_FILE" ps

# --- 9. summary ------------------------------------------------------------

cat <<SUMMARY

============================================================
 Akela is up.

   Landing:    https://${AKELA_DOMAIN}
   Dashboard:  https://${AKELA_DOMAIN}/pack
   API docs:   https://${AKELA_DOMAIN}/akela-api/docs

 Login:
   user:       ${ADMIN_USERNAME}
   password:   ${ADMIN_PASSWORD}

 Generated secrets are stored in:
   ${ENV_FILE}   (mode 600 — back this up somewhere safe)

 Useful commands (from ${AKELA_DIR}):
   docker compose -f docker-compose.prod.yml logs -f api
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml restart api
   docker compose -f docker-compose.prod.yml down

 Notes:
  * DNS A record for ${AKELA_DOMAIN} must point to this server's
    public IP, or Let's Encrypt cert issuance will fail.
  * First HTTPS request triggers cert provisioning (a few seconds).
  * To enable Web Push, generate VAPID keys with:
      docker compose -f docker-compose.prod.yml exec api vapid --gen
    then fill VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env and
    restart the api service.
============================================================
SUMMARY
