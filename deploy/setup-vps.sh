#!/usr/bin/env bash
# One-time (idempotent) VPS provisioning for stravaBoard.
#
# Usage: deploy/setup-vps.sh [ssh-host]
#
# Installs Node 22 (via the VPS's nvm) and Caddy, creates the app layout,
# installs the systemd unit and the Caddyfile (generating a basic-auth
# password on first run), and writes the production .env from the local one.
# Run deploy/deploy.sh afterwards to ship the code.
set -euo pipefail

HOST="${1:-crovps}"
APP_DIR=/home/ubuntu/stravaboard
DOMAIN=strava.pectum.fr
# Strava athlete ids allowed to sign in (comma-separated). Extend for family.
ALLOWED_IDS="${ALLOWED_ATHLETE_IDS:-798002}"

cd "$(dirname "$0")/.."

echo "== Node 22 =="
ssh "$HOST" 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  nvm install 22 >/dev/null 2>&1
  sudo ln -sfn "$(nvm which 22)" /usr/local/bin/node22
  echo "node22 -> $(node22 --version)"'

echo "== Caddy =="
ssh "$HOST" 'command -v caddy >/dev/null 2>&1 && { echo "caddy already installed: $(caddy version)"; exit 0; }
  sudo apt-get update -qq
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y -qq caddy >/dev/null
  echo "caddy installed: $(caddy version)"'

echo "== App layout =="
ssh "$HOST" "mkdir -p $APP_DIR/server $APP_DIR/web $APP_DIR/data"

echo "== systemd unit =="
ssh "$HOST" 'sudo tee /etc/systemd/system/stravaboard.service >/dev/null && sudo systemctl daemon-reload && sudo systemctl enable stravaboard >/dev/null 2>&1 && echo unit installed' <deploy/stravaboard.service

echo "== .env =="
if ssh "$HOST" "test -f $APP_DIR/.env"; then
  # Idempotent upgrades: add the multi-user vars to an existing .env.
  ssh "$HOST" "grep -q '^COOKIE_SECRET=' $APP_DIR/.env || echo 'COOKIE_SECRET=$(openssl rand -hex 32)' >> $APP_DIR/.env"
  ssh "$HOST" "grep -q '^ALLOWED_ATHLETE_IDS=' $APP_DIR/.env || echo 'ALLOWED_ATHLETE_IDS=$ALLOWED_IDS' >> $APP_DIR/.env"
  echo ".env present — COOKIE_SECRET and ALLOWED_ATHLETE_IDS ensured"
else
  {
    grep -E '^(STRAVA_CLIENT_ID|STRAVA_CLIENT_SECRET|MAPTILER_KEY)=' .env
    echo "PORT=3001"
    echo "HOST=127.0.0.1"
    echo "APP_BASE_URL=https://$DOMAIN"
    echo "DATABASE_PATH=$APP_DIR/data/stravaboard.sqlite"
    echo "WEB_DIST_PATH=$APP_DIR/web"
    echo "WEB_APP_URL=/"
    echo "COOKIE_SECRET=$(openssl rand -hex 32)"
    echo "ALLOWED_ATHLETE_IDS=$ALLOWED_IDS"
  } | ssh "$HOST" "cat > $APP_DIR/.env && chmod 600 $APP_DIR/.env && echo .env written"
fi

echo "== Caddyfile =="
if ssh "$HOST" 'test -f /etc/caddy/Caddyfile && grep -q reverse_proxy /etc/caddy/Caddyfile && ! grep -q basic_auth /etc/caddy/Caddyfile'; then
  echo "Caddyfile already configured — left untouched"
else
  ssh "$HOST" 'sudo tee /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy' <deploy/Caddyfile
  echo "Caddyfile installed — the app's Strava login is the only gate"
fi

echo "== Done. Next: deploy/deploy.sh =="
