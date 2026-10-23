#!/usr/bin/env bash
# Daily SEO check scheduler.
#   ./seo/cron.sh install [HH:MM]   add a daily cron job (default 06:00)
#   ./seo/cron.sh remove            remove it
#   ./seo/cron.sh status            show the cron entry and the latest summary
#   ./seo/cron.sh run               run the check now (this is what cron calls)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARK="# hilutzei-shetach-seo"
LOGS="$ROOT/logs/seo"
mkdir -p "$LOGS"

run() {
  cd "$ROOT"
  echo "===== $(date -u '+%Y-%m-%d %H:%M:%S UTC') ====="
  if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then
    node seo/check.mjs
  elif command -v docker >/dev/null; then
    # no Node on this server: run the same script in a throwaway container
    docker run --rm -v "$ROOT":/app -w /app node:22-alpine node seo/check.mjs
  else
    echo "Need Node 18+ or Docker to run the SEO check" >&2; exit 1
  fi
}

case "${1:-}" in
  install)
    t="${2:-06:00}"; h="${t%%:*}"; m="${t##*:}"
    [[ "$h" =~ ^[0-9]{1,2}$ && "$m" =~ ^[0-9]{1,2}$ ]] || { echo "time must be HH:MM" >&2; exit 1; }
    ( crontab -l 2>/dev/null | grep -v "$MARK" || true
      echo "$((10#$m)) $((10#$h)) * * * \"$ROOT/seo/cron.sh\" run >> \"$LOGS/cron.log\" 2>&1 $MARK" ) | crontab -
    echo "Installed: daily at $t. Output goes to $LOGS/cron.log"; ;;
  remove)
    ( crontab -l 2>/dev/null | grep -v "$MARK" || true ) | crontab -
    echo "Removed"; ;;
  status)
    crontab -l 2>/dev/null | grep "$MARK" || echo "No cron entry installed"
    f=$(ls -1t "$LOGS"/20*.json 2>/dev/null | head -n1 || true)
    [ -n "$f" ] && echo "Latest report: $f" || echo "No report yet"
    [ -f "$LOGS/cron.log" ] && { echo "--- last cron output ---"; tail -n 25 "$LOGS/cron.log"; } || true ;;
  run) run ;;
  *) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
