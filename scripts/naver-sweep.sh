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
echo "=== $(date '+%Y-%m-%d %H:%M:%S') naver-sweep 시작 ===" | tee -a "$LOG"
npx tsx scripts/naver-sweep.ts 2>&1 | tee -a "$LOG"
echo "--- 신규 단지 좌표 백필(통근·상권 점수용) ---" | tee -a "$LOG"
npx tsx scripts/backfill-coords.ts 2>&1 | tee -a "$LOG"
echo "--- 신규 단지 용적률 백필(재건축 사업성 지표) ---" | tee -a "$LOG"
npx tsx scripts/backfill-far.ts 2>&1 | tee -a "$LOG"
echo "--- 카카오 실데이터 증분 수집(역·상권·자차경로) ---" | tee -a "$LOG"
npx tsx scripts/refresh-kakao-context.ts 2>&1 | tee -a "$LOG"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') naver-sweep 종료 ===" | tee -a "$LOG"
