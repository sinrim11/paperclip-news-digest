#!/bin/bash
# Telegram Bot Launcher
# Starts the enhanced Telegram bot for News Digest + Paperclip integration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment variables if .env exists
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Set defaults if not set
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-REDACTED-ROTATE-ME}"
export TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-7187585050}"
export PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-http://127.0.0.1:3100/api}"
export PAPERCLIP_COMPANY_ID="${PAPERCLIP_COMPANY_ID:-64e10e8b-55f9-4792-ada5-d6ab564be978}"

# Check Python installation
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed"
    exit 1
fi

# Check if python-telegram-bot is installed
if ! python3 -c "import telegram" 2>/dev/null; then
    echo "📦 Installing dependencies..."
    pip3 install -r requirements_bot.txt
fi

echo "🤖 Starting Telegram Bot..."
echo "📊 Paperclip API: $PAPERCLIP_API_URL"
echo "🏢 Company ID: $PAPERCLIP_COMPANY_ID"
echo ""
echo "Press Ctrl+C to stop the bot"
echo ""

# Start the bot
python3 telegram_bot.py
