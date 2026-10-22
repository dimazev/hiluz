#!/usr/bin/env bash
# Install or upgrade the site in Docker (one command for both).
#
#   ./update.sh                              first run: asks for the domain, creates .env, builds and starts.
#                                            later runs: pulls the latest from git, rebuilds, restarts.
#   ./update.sh --domain https://x.co.il     set / change the public domain (non-interactive)
#   ./update.sh --port 8081                  use this host port (must be free). Without it the script picks the
#                                            first free port from 8080 up and remembers it in .env
#   ./update.sh --no-pull                    rebuild from the files on disk, skip git pull
set -euo pipefail
cd "$(dirname "$0")"

NAME=hilutzei-shetach
PULL=1
ARG_DOMAIN=""
ARG_PORT=""

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "Error: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) PULL=0 ;;
    --domain) ARG_DOMAIN="${2:-}"; shift ;;
    --domain=*) ARG_DOMAIN="${1#*=}" ;;
    --port) ARG_PORT="${2:-}"; shift ;;
    --port=*) ARG_PORT="${1#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  shift
done

command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is missing"
docker info >/dev/null 2>&1 || die "the docker daemon is not running (or you lack permission: try sudo)"

# set KEY=value in .env (create the file or the line if missing)
set_env() {
  local key="$1" val="$2" tmp
  touch .env
  tmp=$(mktemp)
  grep -v "^${key}=" .env > "$tmp" || true
  echo "${key}=${val}" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}
get_env() { grep "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- || true; }

# is something already listening on this local port? (plain bash, works on Linux and macOS)
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# first free port at or above $1
find_port() {
  local p="$1" end=$(( $1 + 200 ))
  while [ "$p" -le "$end" ]; do
    port_busy "$p" || { echo "$p"; return 0; }
    p=$(( p + 1 ))
  done
  return 1
}

# ---- configuration (.env) ----
FIRST_RUN=0
[ -f .env ] || FIRST_RUN=1

DOMAIN_VAL="${ARG_DOMAIN:-$(get_env DOMAIN)}"
if { [ -z "$DOMAIN_VAL" ] || [[ "$DOMAIN_VAL" == *example.co.il* ]]; } && [ -t 0 ]; then
  read -r -p "Public domain of the site (e.g. https://your-domain.co.il): " DOMAIN_VAL
fi
[ -n "$DOMAIN_VAL" ] || die "no domain. Run: ./update.sh --domain https://your-domain.co.il"
[[ "$DOMAIN_VAL" == http://* || "$DOMAIN_VAL" == https://* ]] || DOMAIN_VAL="https://$DOMAIN_VAL"
DOMAIN_VAL="${DOMAIN_VAL%/}"
[[ "$DOMAIN_VAL" == *example.co.il* ]] && die "DOMAIN is still the placeholder"

# ---- port: keep the saved one, otherwise scan for a free one and remember it ----
# the host port our own container already publishes (empty on the first run)
CUR_PORT=$(docker port "$NAME" 80/tcp 2>/dev/null | head -n1 | sed 's/.*://' || true)
SAVED_PORT="$(get_env PORT)"
if [ -n "$ARG_PORT" ]; then
  [[ "$ARG_PORT" =~ ^[0-9]+$ ]] || die "--port must be a number (got: $ARG_PORT)"
  PORT_VAL="$ARG_PORT"
  [ "$PORT_VAL" = "$CUR_PORT" ] || ! port_busy "$PORT_VAL" || die "port $PORT_VAL is already in use. Pick another with --port, or omit it to auto-select"
elif [ -z "$SAVED_PORT" ]; then
  PORT_VAL=$(find_port 8080) || die "no free port found between 8080 and 8280"
  echo "Free port found: $PORT_VAL"
elif [ "$SAVED_PORT" = "$CUR_PORT" ] || ! port_busy "$SAVED_PORT"; then
  PORT_VAL="$SAVED_PORT"
else
  PORT_VAL=$(find_port $(( SAVED_PORT + 1 ))) || die "no free port found above $SAVED_PORT"
  echo "Port $SAVED_PORT is taken by something else; using $PORT_VAL"
fi
[[ "$PORT_VAL" =~ ^[0-9]+$ ]] || die "PORT must be a number (got: $PORT_VAL)"

set_env DOMAIN "$DOMAIN_VAL"
set_env PORT "$PORT_VAL"

# ---- mode ----
if docker inspect "$NAME" >/dev/null 2>&1; then
  MODE=upgrade
else
  MODE=install
fi
echo "== $MODE: $DOMAIN_VAL on port $PORT_VAL =="
[ "$FIRST_RUN" = 1 ] && echo "Created .env"

# ---- latest content ----
if [ "$PULL" = 1 ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git remote get-url origin >/dev/null 2>&1; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    die "uncommitted changes in tracked files. Commit or stash them, or run with --no-pull"
  fi
  before=$(git rev-parse --short HEAD)
  git pull --ff-only
  after=$(git rev-parse --short HEAD)
  if [ "$before" = "$after" ]; then echo "Content already at $after"; else echo "Content updated $before -> $after"; fi
fi

# ---- build and (re)start ----
echo "Building image..."
docker compose build --pull
echo "Starting container..."
docker compose up -d --remove-orphans

echo -n "Waiting for the container to become healthy"
state=starting
for _ in $(seq 1 40); do
  state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$NAME" 2>/dev/null || echo starting)
  case "$state" in healthy|running) break ;; esac
  echo -n "."
  sleep 1
done
echo
if [ "$state" != "healthy" ] && [ "$state" != "running" ]; then
  echo "Container is '$state'. Last logs:" >&2
  docker compose logs --tail=40 web >&2
  exit 1
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT_VAL}/" || true)
[ "$code" = "200" ] && echo "Site OK (http://127.0.0.1:${PORT_VAL}/)" || echo "Warning: site returned '$code'"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT_VAL}/stats/script.js" || true)
[ "$code" = "200" ] && echo "Analytics proxy OK" || echo "Warning: /stats/script.js returned '$code' (can this server reach umami.dzev.net?)"

docker image prune -f >/dev/null 2>&1 || true
echo "Done ($MODE). Point your HTTPS reverse proxy at http://127.0.0.1:${PORT_VAL}"
