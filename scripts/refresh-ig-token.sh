#!/bin/zsh
# 인스타그램 장기 토큰 주간 갱신 (launchd: com.news-digest.ig-refresh, 월 05:30)
# 성공 시 웹 서버를 재기동해 새 토큰을 서버 액션(게시 버튼)에 반영한다.
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=3000"
LOG="output/ig_refresh.log"

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

echo "=== $(date '+%Y-%m-%d %H:%M:%S') ig-refresh 시작 ===" >> "$LOG"
if npx tsx scripts/refresh-ig-token.ts >> "$LOG" 2>&1; then
  # 새 토큰을 웹 서버(게시 액션)에 반영 — 빌드 불변이라 탭 배너는 뜨지 않음
  launchctl kickstart -k "gui/$(id -u)/com.news-digest.web" >> "$LOG" 2>&1 || true
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') 완료(웹 재기동) ===" >> "$LOG"
else
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') 실패 — 기존 토큰 유지 ===" >> "$LOG"
fi
