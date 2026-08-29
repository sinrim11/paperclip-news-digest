#!/bin/zsh
# 도시계획 고시 선행 감지 (launchd: com.news-digest.gosi, 매일 06:20)
# 재개발·지구단위계획·주택건설 승인은 고시로 먼저 공개되고 기사는 그걸 받아쓴다 → 원문을 먼저 잡는다.
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=3000"
LOG="output/gosi.log"
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a
echo "=== $(date '+%Y-%m-%d %H:%M:%S') collect-gosi 시작 ===" >> "$LOG"
npx tsx scripts/collect-gosi.ts --pages=12 >> "$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') exit=$? ===" >> "$LOG"
