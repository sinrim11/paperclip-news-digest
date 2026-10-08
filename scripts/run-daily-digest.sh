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

# ── 경제캘린더 재수집 (2026-09-15) ───────────────────────────────────────────
# 캘린더는 '오늘 발표 예정' 데이터라 TradingAgents의 17:00 수집분은 아침이면 이미 지난
# 일정이다. 다이제스트 직전에 당일치를 새로 받는다. investing.com은 Cloudflare Turnstile
# 때문에 CDP Chrome + 사람이 1회 로그인한 세션이 필요해 그쪽 스크립트를 그대로 호출한다.
#
# 불사 원칙: 실패해도 다이제스트는 그대로 진행한다(|| true). 세션이 만료돼 캐시가 어제
# 날짜로 남으면 읽는 쪽(src/lib/econ-calendar.ts)이 날짜 불일치로 표시하지 않는다 —
# 전날 일정을 '오늘 예정'으로 내보내는 것이 이 연동의 유일한 거짓말 경로라 거기를 막았다.
#
# macOS엔 coreutils의 timeout이 없다 → 워치독으로 90초 상한. Chrome 기동 실패·세션 만료
# 시 얼마나 걸릴지 알 수 없는데, 캘린더 때문에 06:30 다이제스트가 밀리면 주객전도다.
TA="/Users/sklee01/TradingAgents-ClaudeCLI"
if [ -x "$TA/.venv/bin/python" ]; then
  echo "[$(ts)] econ-calendar refresh" >> "$LOG"
  ( cd "$TA" && ./.venv/bin/python scripts/investing_pro.py --econ >> "/Users/sklee01/news-digest/$LOG" 2>&1 ) &
  ECON_PID=$!
  ( sleep 90; kill -TERM "$ECON_PID" 2>/dev/null ) & ECON_WD=$!
  wait "$ECON_PID" 2>/dev/null || echo "[$(ts)] econ-calendar refresh 실패 — 전날 캐시는 날짜 불일치로 표시되지 않음" >> "$LOG"
  kill "$ECON_WD" 2>/dev/null || true
fi

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
