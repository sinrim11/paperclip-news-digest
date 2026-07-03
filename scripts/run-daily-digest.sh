#!/bin/zsh
# 매일 06:30 다이제스트 생성 트리거 (launchd: com.news-digest.daily)
# /api/cron/daily 호출 → 생성 + Slack/Telegram 알림은 라우트가 처리.
set -uo pipefail
cd /Users/sklee01/news-digest
LOG="output/daily_run.log"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

# Next.js와 동일한 우선순위로 env 로드 (.env → .env.local이 덮어씀)
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

AUTH=()
[ -n "${CRON_SECRET:-}" ] && AUTH=(-H "Authorization: Bearer ${CRON_SECRET}")

echo "[$(ts)] daily digest trigger" >> "$LOG"
HTTP=$(curl -s -o /tmp/news_digest_daily_resp.json -w '%{http_code}' -m 2700 \
  -X POST "${AUTH[@]}" http://localhost:3200/api/cron/daily 2>> "$LOG")
echo "[$(ts)] HTTP ${HTTP}: $(head -c 300 /tmp/news_digest_daily_resp.json 2>/dev/null)" >> "$LOG"

# 웹서버 다운 등으로 라우트의 실패 알림 자체가 못 나가는 경우의 최후 경보
if [ "$HTTP" != "200" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  curl -s -m 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"⚠️ [뉴스다이제스트] 06:30 트리거 실패 (HTTP ${HTTP}) — 수동 확인 필요\"}" \
    > /dev/null
fi
