#!/bin/zsh
# 부동산 데이터 일일 수집 (launchd: com.news-digest.collect, 매일 06:00)
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
LOG="output/collect_realestate.log"

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

echo "=== $(date '+%Y-%m-%d %H:%M:%S') collect-realestate ===" >> "$LOG"
npx tsx scripts/collect-realestate.ts >> "$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') exit=$? ===" >> "$LOG"
