#!/bin/bash
# run_nextjs.sh — Next.js dev server launcher for LaunchAgent
# Managed by: com.news-digest.nextjs LaunchAgent
# Logs: /Users/sklee01/news-digest/output/nextjs.log

set -euo pipefail

PROJECT_DIR="/Users/sklee01/news-digest"
cd "$PROJECT_DIR"

# Load .env if it exists (LaunchAgent doesn't source shell profiles)
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Next.js dev server (port 3000)..."

exec /opt/homebrew/bin/npm run dev
