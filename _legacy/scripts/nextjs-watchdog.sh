#!/bin/zsh
# Next.js dev server watchdog
# Polls localhost:3200 every 30s; triggers restart-next.sh on 404 / connection failure.
# Designed to run as a LaunchAgent (always-on, auto-restarts if this script dies).
#
# Install: see ~/Library/LaunchAgents/com.paperclip.nextjs-watchdog.plist

set -uo pipefail

PROJECT="${PROJECT:-/Users/sklee01/news-digest}"
PORT="${PORT:-3200}"
POLL_INTERVAL="${POLL_INTERVAL:-30}"
RESTART_COOLDOWN="${RESTART_COOLDOWN:-60}"   # min seconds between restarts
WATCHDOG_LOG="${WATCHDOG_LOG:-/tmp/nextjs_watchdog.log}"
RESTART_SCRIPT="$PROJECT/scripts/restart-next.sh"
LOCK_FILE="/tmp/nextjs_watchdog.lock"

_log() {
  local msg="[watchdog] $(date '+%Y-%m-%d %H:%M:%S') $*"
  echo "$msg" | tee -a "$WATCHDOG_LOG" >&2
}

_is_healthy() {
  local code
  code=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" -m 5 "http://localhost:$PORT/" 2>/dev/null || echo 000)
  # 200/302/307 = healthy; 404 on / or connection refused = unhealthy
  if [[ "$code" == "200" || "$code" == "302" || "$code" == "307" ]]; then
    return 0
  fi
  _log "unhealthy response: http $code"
  return 1
}

_check_static_chunks() {
  # Check that a known static chunk path resolves (not 404)
  local manifest_code
  manifest_code=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" -m 5 \
    "http://localhost:$PORT/_next/static/chunks/main-app.js" 2>/dev/null || echo 000)
  if [[ "$manifest_code" == "404" ]]; then
    _log "static chunk 404 detected (main-app.js returned 404) — HMR cache corruption"
    return 1
  fi
  return 0
}

_do_restart() {
  local reason="$1"
  _log "=== RESTART TRIGGERED: $reason ==="

  # Cooldown guard: don't restart more often than RESTART_COOLDOWN seconds
  if [[ -f "$LOCK_FILE" ]]; then
    local lock_age
    lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
    if [[ "$lock_age" -lt "$RESTART_COOLDOWN" ]]; then
      _log "cooldown active (last restart ${lock_age}s ago, cooldown=${RESTART_COOLDOWN}s) — skipping"
      return 0
    fi
  fi

  touch "$LOCK_FILE"
  _log "running: $RESTART_SCRIPT"
  if /bin/zsh "$RESTART_SCRIPT" >> "$WATCHDOG_LOG" 2>&1; then
    _log "restart succeeded"
  else
    _log "restart FAILED — will retry next poll"
  fi
}

# Rotate watchdog log at startup (keep last 1000 lines)
if [[ -f "$WATCHDOG_LOG" ]]; then
  tail -1000 "$WATCHDOG_LOG" > "${WATCHDOG_LOG}.prev" 2>/dev/null || true
  : > "$WATCHDOG_LOG"
fi

_log "=== watchdog started (port=$PORT, poll=${POLL_INTERVAL}s) ==="

CONSECUTIVE_FAILURES=0

while true; do
  sleep "$POLL_INTERVAL"

  if _is_healthy; then
    # Also check static chunks if main page is healthy
    if ! _check_static_chunks; then
      CONSECUTIVE_FAILURES=$(( CONSECUTIVE_FAILURES + 1 ))
      _log "static chunk failure #$CONSECUTIVE_FAILURES"
      if [[ "$CONSECUTIVE_FAILURES" -ge 2 ]]; then
        _do_restart "static chunks 404 (${CONSECUTIVE_FAILURES} consecutive)"
        CONSECUTIVE_FAILURES=0
      fi
    else
      CONSECUTIVE_FAILURES=0
      _log "healthy (200 + chunks OK)"
    fi
  else
    CONSECUTIVE_FAILURES=$(( CONSECUTIVE_FAILURES + 1 ))
    _log "health check failure #$CONSECUTIVE_FAILURES"
    if [[ "$CONSECUTIVE_FAILURES" -ge 2 ]]; then
      _do_restart "main page unhealthy (${CONSECUTIVE_FAILURES} consecutive)"
      CONSECUTIVE_FAILURES=0
    fi
  fi
done
