#!/bin/zsh
# 일일 매물 추천 발송 — 규칙 엔진 → 텔레그램 → 로테이션 로그.
# (launchd: com.news-digest.recommend, 매일 08:30 · 07:00 시장리서치 이후)
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
LOG="output/daily_recommend.log"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

echo "[$(ts)] daily-recommend 시작" >> "$LOG"
npx tsx scripts/daily-recommend.ts >> "$LOG" 2>&1
echo "[$(ts)] daily-recommend 종료(exit=$?)" >> "$LOG"
