#!/bin/zsh
# Next.js dev server watchdog — checks every 60s, auto-restarts on crash
# Usage: runs as LaunchAgent, logs to /tmp/nextjs_watchdog.log

set -uo pipefail

PROJECT="/Users/sklee01/news-digest"
PORT=3200
CHECK_INTERVAL=60
LOG="/tmp/nextjs_watchdog.log"
RESTART_SCRIPT="$PROJECT/scripts/restart-next.sh"

_log() { echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

_log "=== watchdog started (port=$PORT, interval=${CHECK_INTERVAL}s) ==="

while true; do
  code=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" -m 5 "http://localhost:$PORT/" 2>/dev/null || echo 000)

  if [[ "$code" == "000" || "$code" == "502" || "$code" == "503" ]]; then
    _log "ALERT: localhost:$PORT returned $code — restarting Next.js"
    "$RESTART_SCRIPT" >> "$LOG" 2>&1
    _log "restart complete, waiting 30s before next check"
    sleep 30
  elif [[ "$code" == "500" ]]; then
    # 500 might be transient (HMR recompile), wait one more cycle
    _log "WARN: localhost:$PORT returned 500 — waiting one cycle"
    sleep "$CHECK_INTERVAL"
    code2=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" -m 5 "http://localhost:$PORT/" 2>/dev/null || echo 000)
    if [[ "$code2" == "500" || "$code2" == "000" ]]; then
      _log "ALERT: still failing ($code2) — restarting Next.js"
      "$RESTART_SCRIPT" >> "$LOG" 2>&1
      _log "restart complete"
      sleep 30
    fi
  fi

  sleep "$CHECK_INTERVAL"
done
