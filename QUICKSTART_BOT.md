# 🚀 Quick Start: Telegram Bot

Get the Telegram bot running in 2 minutes.

## Prerequisites
- Python 3.8+
- Your Telegram bot token
- Paperclip API running on `http://127.0.0.1:3100`

## Step 1: Set Environment Variables
```bash
export TELEGRAM_BOT_TOKEN="your_token_here"
export TELEGRAM_CHAT_ID="your_chat_id_here"
```

Or create a `.env` file:
```bash
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
PAPERCLIP_API_URL=http://127.0.0.1:3100/api
PAPERCLIP_COMPANY_ID=64e10e8b-55f9-4792-ada5-d6ab564be978
```

## Step 2: Install Dependencies
```bash
pip3 install -r requirements_bot.txt
```

## Step 3: Run the Bot
```bash
./run_telegram_bot.sh
```

Or directly:
```bash
python3 telegram_bot.py
```

## Step 4: Test in Telegram
Send any message to your bot:
- `/status` → See Paperclip status
- `/help` → See all commands
- `/ask` → Ask a question
- `/news` → Manage news alerts

## Features

| Feature | Command | Purpose |
|---------|---------|---------|
| Status | `/status` | Real-time Paperclip dashboard |
| Instructions | `/instructions` | Work assignments & priorities |
| Q&A | `/ask` | Answer questions |
| News | `/news` | Configure alerts |
| Help | `/help` | Command reference |

## Troubleshooting

### Bot not responding
1. Check if running: `ps aux | grep telegram_bot`
2. Check CHAT_ID is correct
3. Check bot token is valid
4. Look for errors in terminal

### Paperclip API unreachable
1. Check if Paperclip is running on port 3100
2. Test: `curl http://127.0.0.1:3100/api/companies/64e10e8b-55f9-4792-ada5-d6ab564be978/issues | head`

### Module not found errors
```bash
pip3 install --upgrade python-telegram-bot requests
```

## Next Steps

- Read [TELEGRAM_BOT.md](TELEGRAM_BOT.md) for detailed documentation
- Run tests: `python3 test_telegram_bot.py`
- Integrate with news pipeline: See [main.py](main.py)

---

**Status**: ✅ Ready to run
**Last Updated**: 2026-04-13
