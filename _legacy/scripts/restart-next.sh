#!/bin/zsh
# Clean single-instance Next.js dev restart
# Usage: ~/news-digest/scripts/restart-next.sh [--no-cache]
# - Kills ALL existing `next dev` / `next-server` processes
# - Waits for port 3200 to be fully released
# - Removes .next cache (cures corrupted HMR state)
# - Starts a single fresh instance on PORT=3200
# - Log: /tmp/nextjs_dev.log
# - Returns 0 on success, 1 on timeout

set -euo pipefail

PROJECT="${PROJECT:-/Users/sklee01/news-digest}"
PORT="${PORT:-3200}"
LOG="${LOG:-/tmp/nextjs_dev.log}"
WAIT_SECS="${WAIT_SECS:-30}"
NO_CACHE="${1:-}"

_log() {
  echo "[restart-next] $(date '+%Y-%m-%d %H:%M:%S') $*" >&2
}

_log "=== start (port=$PORT) ==="

# --- Step 1: Kill all next-related processes ---
_log "killing next dev / next-server processes..."
/usr/bin/pkill -TERM -f "next dev" 2>/dev/null || true
/usr/bin/pkill -TERM -f "next-server" 2>/dev/null || true
sleep 1

# Hard kill anything still lingering
/usr/bin/pkill -KILL -f "next dev" 2>/dev/null || true
/usr/bin/pkill -KILL -f "next-server" 2>/dev/null || true

# --- Step 2: Release the port ---
_log "releasing port $PORT..."
PORT_PIDS=$(/usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
if [[ -n "$PORT_PIDS" ]]; then
  echo "$PORT_PIDS" | /usr/bin/xargs -I{} /bin/kill -9 {} 2>/dev/null || true
  _log "killed PIDs on port $PORT: $PORT_PIDS"
fi

# Wait for port to be fully released (up to 5s)
for i in $(seq 1 5); do
  if ! /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  _log "waiting for port $PORT to release (attempt $i)..."
  sleep 1
done

# --- Step 3: Clear .next cache ---
if [[ "$NO_CACHE" != "--keep-cache" ]]; then
  _log "clearing .next cache..."
  /bin/rm -rf "$PROJECT/.next"
else
  _log "skipping cache clear (--keep-cache)"
fi

# --- Step 4: Verify single process before start ---
REMAINING=$(/usr/bin/pgrep -f "next" 2>/dev/null | wc -l | tr -d ' ' || echo 0)
if [[ "$REMAINING" -gt 0 ]]; then
  _log "WARNING: $REMAINING next-related processes still alive, forcing kill..."
  /usr/bin/pkill -KILL -f "next" 2>/dev/null || true
  sleep 1
fi

# --- Step 5: Start fresh instance ---
_log "starting fresh next dev on port $PORT..."
cd "$PROJECT"
# Rotate log: keep last 500 lines to aid debugging
if [[ -f "$LOG" ]]; then
  tail -500 "$LOG" > "${LOG}.prev" 2>/dev/null || true
fi

PORT="$PORT" nohup /opt/homebrew/bin/npm run dev >"$LOG" 2>&1 &
NEW_PID=$!
disown "$NEW_PID" 2>/dev/null || true
_log "spawned pid=$NEW_PID, log=$LOG"

# --- Step 6: Health check loop ---
_log "waiting up to ${WAIT_SECS}s for HTTP 200..."
for i in $(seq 1 "$WAIT_SECS"); do
  code=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" -m 2 "http://localhost:$PORT/" 2>/dev/null || echo 000)
  if [[ "$code" == "200" || "$code" == "307" || "$code" == "302" ]]; then
    _log "=== up at try $i (pid=$NEW_PID, http $code) ==="
    exit 0
  fi
  sleep 1
done

_log "ERROR: not reachable after ${WAIT_SECS}s — check $LOG"
tail -20 "$LOG" >&2 || true
exit 1
