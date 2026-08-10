#!/bin/zsh
# 추천 피드백 봇 상주 실행 (launchd: com.news-digest.feedback-bot, KeepAlive)
set -uo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=3000"
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a
exec npx tsx scripts/telegram-feedback-bot.ts
