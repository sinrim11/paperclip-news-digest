#!/bin/zsh
# 매수 매칭 분석 일일 재생성 — /listings·/matching 페이지 데이터 갱신(/versus는 요청 시 실시간 계산).
#   gen-listings(전체매물 투자분석+10년vs, DB만·빠름) + gen-matching(추적3단지 호가 하베스트·~2분).
# launchd com.news-digest.matching (매일 08:45, 추천 08:30 직후). 실패 비치명(다음날 재시도).
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
LOG="output/daily_matching.log"
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a
echo "=== $(date '+%Y-%m-%d %H:%M:%S') daily-matching 시작 ===" | tee -a "$LOG"
echo "[1/3] gen-listings (전체매물 투자분석+10년vs)" | tee -a "$LOG"
npx tsx scripts/gen-listings.ts 2>&1 | tee -a "$LOG"
echo "[2/3] gen-persona-recos (페르소나별 사전 추천 — /recommend, G3)" | tee -a "$LOG"
npx tsx scripts/gen-persona-recos.ts 2>&1 | tee -a "$LOG"
echo "[3/3] gen-matching (추적 3단지 호가·급매)" | tee -a "$LOG"
npx tsx scripts/gen-matching.ts 2>&1 | tee -a "$LOG"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') daily-matching 종료 ===" | tee -a "$LOG"

# 자율 작업 보고(2026-08-05 지시) — 매칭·매물분석 재생성 결과를 텔레그램으로 보고
L_LISTINGS=$(grep 'listings-analysis.json 생성' "$LOG" | tail -1)
L_MATCHING=$(grep 'matching-analysis.json 생성' "$LOG" | tail -1)
npx tsx scripts/notify-telegram.ts "🤖 자동분석 보고 — 매수매칭 재생성 (08:45)
· ${L_LISTINGS:-매물 분석 결과 확인 불가(로그 참조)}
· ${L_MATCHING:-매칭 분석 결과 확인 불가(로그 참조)}
· 대시보드: /listings · /matching 갱신 완료" >> "$LOG" 2>&1 || true
