#!/bin/zsh
# news-digest 웹 서버 (launchd: com.news-digest.web)
# 프로덕션 빌드가 없으면 빌드 후 next start -p 3200 실행.
set -euo pipefail
cd /Users/sklee01/news-digest
export PATH="/opt/homebrew/bin:$PATH"

if [ ! -f .next/BUILD_ID ]; then
  echo "[start-web] $(date '+%F %T') no production build — running next build..."
  npm run build
fi

exec ./node_modules/.bin/next start -p 3200
