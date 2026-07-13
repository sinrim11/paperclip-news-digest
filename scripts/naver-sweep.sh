#!/bin/zsh
# 네이버 매물 전수 스윕 (수동/최초 1회). env 로드 후 실행.
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
LOG="output/naver_sweep.log"
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a
# 요일 분할 그룹(G2-4): sun=일·목, wed=수·토 — 각 그룹 주 2회 → 지역당 3~4일 간격 재수집.
# 수동 실행 시 인자로 지정 가능: naver-sweep.sh wed | gyeonggi-new | backfill
GROUP="${1:-}"
if [ -z "$GROUP" ]; then
  case "$(date +%u)" in
    3|6) GROUP="wed" ;;
    *) GROUP="sun" ;;
  esac
fi
echo "=== $(date '+%Y-%m-%d %H:%M:%S') naver-sweep 시작 (그룹 $GROUP) ===" | tee -a "$LOG"
npx tsx scripts/naver-sweep.ts --group="$GROUP" 2>&1 | tee -a "$LOG"
echo "--- 신규 단지 좌표 백필(통근·상권 점수용) ---" | tee -a "$LOG"
npx tsx scripts/backfill-coords.ts 2>&1 | tee -a "$LOG"
echo "--- 신규 단지 용적률 백필(재건축 사업성 지표) ---" | tee -a "$LOG"
npx tsx scripts/backfill-far.ts 2>&1 | tee -a "$LOG"
echo "--- 카카오 실데이터 증분 수집(역·상권·자차경로) ---" | tee -a "$LOG"
npx tsx scripts/refresh-kakao-context.ts 2>&1 | tee -a "$LOG"
echo "--- 전체매물 분석 재생성(gen-listings — /listings 즉시 반영, G2-1) ---" | tee -a "$LOG"
npx tsx scripts/gen-listings.ts 2>&1 | tee -a "$LOG"
echo "--- 페르소나별 사전 추천 재생성(gen-persona-recos — /recommend, G3) ---" | tee -a "$LOG"
npx tsx scripts/gen-persona-recos.ts 2>&1 | tee -a "$LOG"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') naver-sweep 종료 ===" | tee -a "$LOG"
