#!/usr/bin/env bash
# Update the running site to the latest content: pull, rebuild the image, restart, verify.
#   ./update.sh            pull latest from git, rebuild, restart
#   ./update.sh --no-pull  rebuild from the files as they are on disk (no git)
set -euo pipefail
cd "$(dirname "$0")"

PULL=1
[ "${1:-}" = "--no-pull" ] && PULL=0

if [ ! -f .env ]; then
  echo "No .env found. Create it first:  cp .env.example .env  and set DOMAIN" >&2
  exit 1
fi
set -a; . ./.env; set +a
if [ -z "${DOMAIN:-}" ] || [[ "$DOMAIN" == *example.co.il* ]]; then
  echo "DOMAIN in .env is not set to your real domain (got: '${DOMAIN:-}')" >&2
  exit 1
fi
PORT="${PORT:-8080}"

command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose plugin is missing" >&2; exit 1; }

if [ "$PULL" = 1 ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Local changes in tracked files; commit or stash them, or run with --no-pull" >&2
    exit 1
  fi
  before=$(git rev-parse --short HEAD)
  git pull --ff-only
  after=$(git rev-parse --short HEAD)
  [ "$before" = "$after" ] && echo "Already at $after" || echo "Updated $before -> $after"
fi

echo "Building and restarting (DOMAIN=$DOMAIN)..."
docker compose build --pull
docker compose up -d --remove-orphans

echo "Waiting for the container to become healthy..."
for _ in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' hilutzei-shetach 2>/dev/null || echo starting)
  [ "$state" = "healthy" ] && break
  sleep 1
done
if [ "${state:-}" != "healthy" ]; then
  echo "Container did not become healthy. Last logs:" >&2
  docker compose logs --tail=40 web >&2
  exit 1
fi

# analytics proxy sanity check (script is served first-party under /stats/)
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/stats/script.js" || true)
[ "$code" = "200" ] && echo "Analytics proxy OK" || echo "Warning: /stats/script.js returned $code (is umami.dzev.net reachable from this server?)"

docker image prune -f >/dev/null
echo "Done. Site is live on port ${PORT}."
