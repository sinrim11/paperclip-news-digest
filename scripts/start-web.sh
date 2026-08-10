#!/bin/zsh
# news-digest 웹 서버 (launchd: com.news-digest.web)
# 프로덕션 빌드가 없으면 빌드 후 next start -p 3200 실행.
set -euo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"
# fetch 간헐 ETIMEDOUT 근본 원인(2026-08-10 확정): IPv6 라우트 부재 + happy-eyeballs 주소별 시도가
# 기본 250ms라 텔레그램(유럽) TCP 핸드셰이크가 자주 초과 → IPv4 우선 + 시도 타임아웃 3s로 교정.
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=3000"

if [ ! -f .next/BUILD_ID ]; then
  echo "[start-web] $(date '+%F %T') no production build — running next build..."
  npm run build
fi

exec ./node_modules/.bin/next start -p 3200
