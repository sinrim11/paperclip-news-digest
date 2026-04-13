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

# Run pipeline
python3 main.py >> "$LOG" 2>&1

# Start web app if not running
if ! lsof -i :3200 -P >/dev/null 2>&1; then
    cd web_app
    nohup python3 -m uvicorn main:app --host 127.0.0.1 --port 3200 >> "$LOG" 2>&1 &
    echo "Web app started on port 3200" >> "$LOG"
    cd ..
fi

echo "=== $(date '+%Y-%m-%d %H:%M:%S') Pipeline complete ===" >> "$LOG"
