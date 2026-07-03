#!/bin/bash
# Daily News Digest Pipeline
# Runs: collect → summarize → generate
# Schedule: 매일 07:00 (결과는 09:00 전 준비)

set -e
cd /Users/sklee01/news-digest

LOG="/Users/sklee01/news-digest/output/daily_run.log"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') Starting daily news pipeline ===" >> "$LOG"

# Activate venv if exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# LM Studio health check
LLM_URL="http://localhost:1234/v1/models"
LLM_MODEL="supergemma4-26b-uncensored-mlx-v2"
BOT_TOKEN="REDACTED-ROTATED-TELEGRAM-TOKEN"
CHAT_ID="7187585050"

if ! curl -sf "$LLM_URL" >/dev/null 2>&1; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') LM Studio offline — alerting and exiting." >> "$LOG"
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"\u26a0\ufe0f [\ub274\uc2a4\ub2e4\uc774\uc81c\uc2a4\ud2b8] LM Studio \uc624\ud504\ub77c\uc778 \u2014 07:00 \ud30c\uc774\ud504\ub77c\uc778 \uc2e4\ud589 \uc2e4\ud328. \uc218\ub3d9 \ud655\uc778 \ud544\uc694.\"}" \
        >> "$LOG" 2>&1
    exit 1
fi

# Pre-warm model: load into VRAM before pipeline starts
echo "$(date '+%Y-%m-%d %H:%M:%S') Pre-warming ${LLM_MODEL}..." >> "$LOG"
WARMUP_RESULT=$(curl -s -X POST "http://localhost:1234/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"${LLM_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":5,\"stream\":false}" \
    --max-time 120 2>&1)
if echo "$WARMUP_RESULT" | grep -q '"content"'; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') Model pre-warm OK." >> "$LOG"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') Model pre-warm failed — alerting and exiting. Response: ${WARMUP_RESULT:0:200}" >> "$LOG"
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": \"\u26a0\ufe0f [\ub274\uc2a4\ub2e4\uc774\uc81c\uc2a4\ud2b8] \ubaa8\ub378 \uc0ac\uc804 \ub85c\ub4dc \uc2e4\ud328 \u2014 07:00 \ud30c\uc774\ud504\ub77c\uc778 \uc911\ub2e8. \uc218\ub3d9 \ud655\uc778 \ud544\uc694.\"}" \
        >> "$LOG" 2>&1
    exit 1
fi

# Run pipeline
python3 main.py >> "$LOG" 2>&1

# Post-pipeline: re-summarize if too many empty/failed summaries
RAW_FILE="output/raw_$(date +%Y%m%d).json"
if [ -f "$RAW_FILE" ]; then
    EMPTY_COUNT=$(RAW_FILE="$RAW_FILE" python3 - <<'PYEOF'
import json, os, re
try:
    with open(os.environ["RAW_FILE"]) as f:
        articles = json.load(f)
    def is_empty(a):
        s = a.get("summary", "") or ""
        if len(s) < 300:
            return True
        korean = len(re.findall(r"[가-힣]", s))
        return korean / len(s) < 0.5 if s else True
    print(sum(1 for a in articles if is_empty(a)))
except Exception:
    print(0)
PYEOF
)
    echo "$(date '+%Y-%m-%d %H:%M:%S') Empty/failed summaries after pipeline: ${EMPTY_COUNT}" >> "$LOG"
    if [ "${EMPTY_COUNT:-0}" -gt 5 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') ${EMPTY_COUNT} empty summaries — triggering re-summarization..." >> "$LOG"
        python3 summarizer.py "$RAW_FILE" >> "$LOG" 2>&1
        echo "$(date '+%Y-%m-%d %H:%M:%S') Re-summarization complete." >> "$LOG"
    fi
fi

# Start web app if not running
if ! lsof -i :3201 -P >/dev/null 2>&1; then
    cd web_app
    nohup python3 -m uvicorn main:app --host 127.0.0.1 --port 3201 >> "$LOG" 2>&1 &
    echo "Web app started on port 3201" >> "$LOG"
    cd ..
fi

echo "=== $(date '+%Y-%m-%d %H:%M:%S') Pipeline complete ===" >> "$LOG"
