#!/usr/bin/env bash
# Deploy stravaBoard to the VPS: run the quality gates, build, ship, restart.
#
# Usage: deploy/deploy.sh [--skip-checks] [ssh-host]
#   --skip-checks  build and ship without re-running the gates (CI already green)
set -euo pipefail

SKIP_CHECKS=false
HOST=crovps
for arg in "$@"; do
  case "$arg" in
    --skip-checks) SKIP_CHECKS=true ;;
    *) HOST="$arg" ;;
  esac
done
APP_DIR=/home/ubuntu/stravaboard

cd "$(dirname "$0")/.."

if [ "$SKIP_CHECKS" = true ]; then
  pnpm build
else
  echo "== Quality gates =="
  pnpm lint
  pnpm format:check
  pnpm typecheck
  pnpm test:coverage
  pnpm build
  pnpm e2e
fi

echo "== Runtime dependency manifest =="
node -e '
  const p = require("./apps/server/package.json")
  const deps = { ...p.dependencies }
  delete deps["@stravaboard/shared"] // bundled into dist by tsup
  const manifest = { name: "stravaboard-runtime", private: true, type: "module", dependencies: deps }
  require("fs").writeFileSync(".deploy-package.json", JSON.stringify(manifest, null, 2))
'

echo "== Ship artifacts =="
rsync -az --delete apps/server/dist/ "$HOST:$APP_DIR/server/"
rsync -az --delete apps/web/dist/ "$HOST:$APP_DIR/web/"
rsync -az .deploy-package.json "$HOST:$APP_DIR/package.json"
rm .deploy-package.json

echo "== Install runtime dependencies =="
ssh "$HOST" 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
  cd '"$APP_DIR"' && npm install --omit=dev --no-audit --no-fund --loglevel=error'

echo "== Restart =="
ssh "$HOST" 'sudo systemctl restart stravaboard'

echo "== Health check =="
ssh "$HOST" 'for i in $(seq 1 15); do
    if curl -fsS http://127.0.0.1:3001/api/health 2>/dev/null; then echo; exit 0; fi
    sleep 1
  done
  echo "service did not become healthy:" >&2
  systemctl status stravaboard --no-pager | tail -5 >&2
  exit 1'
echo "Deployed."
