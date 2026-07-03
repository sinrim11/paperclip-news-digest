#!/usr/bin/env bash
# wait-and-inject.sh — polls Ollama until free, then runs inject-direct.ts
# Usage: bash scripts/wait-and-inject.sh 2026-04-14 [STOCKS,REALESTATE]

set -euo pipefail

DATE="${1:-2026-04-14}"
CATS="${2:-STOCKS,REALESTATE}"
LOG_FILE="/tmp/wait-and-inject-${DATE}.log"
STATUS_FILE="/tmp/wait-and-inject-status-${DATE}.txt"

echo "$(date): Starting wait-and-inject for $DATE cats=$CATS" | tee "$LOG_FILE"
echo "WAITING" > "$STATUS_FILE"

# Poll Ollama until it responds quickly (< 30s for a trivial prompt)
MAX_WAIT=3600  # 60 minutes max
POLL_INTERVAL=30
elapsed=0

while true; do
  response=$(node -e "
    const start = Date.now();
    fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model:'gemma4:26b',messages:[{role:'user',content:'OK?'}],max_tokens:3,stream:false}),
      signal: AbortSignal.timeout(25000)
    })
      .then(r => r.json())
      .then(d => { console.log('FREE:' + (Date.now()-start)); })
      .catch(e => { console.log('BUSY:' + (Date.now()-start)); });
  " 2>/dev/null)

  if [[ "$response" == FREE:* ]]; then
    echo "$(date): Ollama is free! (${response})" | tee -a "$LOG_FILE"
    break
  fi

  elapsed=$((elapsed + POLL_INTERVAL))
  if [[ $elapsed -ge $MAX_WAIT ]]; then
    echo "$(date): TIMEOUT waiting for Ollama after ${MAX_WAIT}s" | tee -a "$LOG_FILE"
    echo "TIMEOUT" > "$STATUS_FILE"
    exit 1
  fi

  echo "$(date): Ollama busy, waiting ${POLL_INTERVAL}s... (${elapsed}s elapsed)" | tee -a "$LOG_FILE"
  sleep "$POLL_INTERVAL"
done

# Run the direct inject
echo "$(date): Running inject-direct.ts for $DATE cats=$CATS..." | tee -a "$LOG_FILE"
cd /Users/sklee01/news-digest

node_modules/.bin/tsx --env-file=.env.local scripts/inject-direct.ts "$DATE" "$CATS" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "$(date): SUCCESS" | tee -a "$LOG_FILE"
  echo "DONE" > "$STATUS_FILE"
else
  echo "$(date): FAILED (exit $EXIT_CODE)" | tee -a "$LOG_FILE"
  echo "FAILED:$EXIT_CODE" > "$STATUS_FILE"
fi
