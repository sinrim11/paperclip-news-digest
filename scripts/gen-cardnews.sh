#!/bin/zsh
# 카드뉴스 자동 생성 (launchd: com.news-digest.cardnews, 매일 09:00) — 3-A 시리즈 로테이션
#   화·목·토 = 8억 큐레이션 / 그 외 = 6억 큐레이션 / 월요일엔 호재·정책 브리핑 추가 생성
#   수동: scripts/gen-cardnews.sh [price6|price8|briefing]
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
LOG="output/cardnews_gen.log"
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

SERIES="${1:-}"
DOW="$(date +%u)" # 1=월 … 7=일
if [ -z "$SERIES" ]; then
  case "$DOW" in
    2|4|6) SERIES="price8" ;;
    *) SERIES="price6" ;;
  esac
fi
echo "=== $(date '+%Y-%m-%d %H:%M:%S') gen-cardnews 시작 (시리즈 $SERIES)" | tee -a "$LOG"
npx tsx scripts/gen-cardnews.ts --series="$SERIES" 2>&1 | tee -a "$LOG"
# 월요일: 주간 호재·정책 브리핑 추가 생성(수동 시리즈 지정 시 생략)
if [ -z "${1:-}" ] && [ "$DOW" = "1" ]; then
  echo "--- 월요일 브리핑 시리즈 추가 생성 ---" | tee -a "$LOG"
  npx tsx scripts/gen-cardnews.ts --series=briefing 2>&1 | tee -a "$LOG"
fi
echo "=== $(date '+%Y-%m-%d %H:%M:%S') gen-cardnews 종료" | tee -a "$LOG"
