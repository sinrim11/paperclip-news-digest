# 📱 News Digest Telegram Bot

Enhanced Telegram bot for News Digest with Paperclip integration, supporting status queries, work instructions, Q&A, and news alerts.

## ✨ Features

### 1. **Paperclip 상태 조회** (Status Queries)
- Real-time Paperclip issue tracking
- Dashboard showing: Done, In Progress, TODO, Blocked counts
- Quick refresh button for live updates
- Command: `/status`

### 2. **업무 지시** (Work Instructions)
- Current task assignments and priorities
- Team contact information
- Delegation guidelines
- Command: `/instructions`

### 3. **일반 질문** (General Q&A)
- Interactive question answering system
- Knowledge base for common questions
- Guided help for bot usage
- Command: `/ask`

### 4. **뉴스 알림** (News Alerts)
- News digest delivery to Telegram
- Configurable alert settings
- Task completion notifications
- Command: `/news`

## 🚀 Installation & Setup

### Prerequisites
- Python 3.8+
- Telegram bot token
- Paperclip API access

### Step 1: Install Dependencies
```bash
pip3 install -r requirements_bot.txt
```

### Step 2: Configure Environment Variables
Create `.env` file in the project root:
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
PAPERCLIP_API_URL=http://127.0.0.1:3100/api
PAPERCLIP_COMPANY_ID=64e10e8b-55f9-4792-ada5-d6ab564be978
PAPERCLIP_API_KEY=your_api_key_optional
```

Or set as environment variables directly:
```bash
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_CHAT_ID="..."
```

### Step 3: Run the Bot
```bash
./run_telegram_bot.sh
```

Or directly:
```bash
python3 telegram_bot.py
```

## 📋 Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Initialize bot and welcome message | `/start` |
| `/status` | Show Paperclip status dashboard | `/status` |
| `/instructions` | Display work instructions & delegation | `/instructions` |
| `/news` | Configure news alert settings | `/news` |
| `/ask` | Start Q&A conversation | `/ask` |
| `/help` | Show all available commands | `/help` |
| `/cancel` | Cancel current operation | `/cancel` |

## 🎯 Usage Examples

### Check Work Status
```
User: /status
Bot: 📊 Paperclip 상태
    ✅ 완료: 15
    🔄 진행: 3
    📝 TODO: 8
    🚫 블록: 1
    진행률: 15/27 (55%)
```

### Get Work Instructions
```
User: /instructions
Bot: 📋 업무 지시사항
    [Current assignments and priorities...]
```

### Ask a Question
```
User: /ask
Bot: [Asks for question]
User: 텔레그램 봇은 어떻게 작동하나?
Bot: [Provides answer from knowledge base]
```

## 🔧 Architecture

### Files

**telegram_bot.py** (Main Bot)
- Command handlers for `/status`, `/instructions`, `/ask`, `/news`, `/help`
- Paperclip API integration
- Button-based navigation with inline keyboards
- Conversation flow for Q&A
- Message parsing and routing

**telegram_news_alerts.py** (Alert System)
- News digest delivery to Telegram
- Paperclip task notifications
- Status reports
- Integration with news generation pipeline

**run_telegram_bot.sh** (Launcher)
- Environment setup
- Dependency checking
- Bot startup script

## 📊 Integration with Paperclip API

The bot queries the Paperclip API endpoint:
```
GET /api/companies/{COMPANY_ID}/issues
```

Returns issue statistics:
- Total issues count
- Status breakdown (done, in_progress, todo, blocked)
- Issue details for display

Example API response format:
```json
{
  "status": "ok",
  "stats": {
    "total": 27,
    "done": 15,
    "in_progress": 3,
    "todo": 8,
    "blocked": 1
  }
}
```

## 🔌 Integration with News Digest

The bot sends news digests through `telegram_news_alerts.py`:

1. **Daily Digest** - Automatic news digest delivery
2. **Task Notifications** - Alert when tasks are completed
3. **Status Reports** - Periodic status summaries

Functions:
- `send_news_digest(digest_path)` - Send news file to Telegram
- `send_paperclip_alert(status_type, issue_title, issue_id)` - Send work notifications
- `send_status_report()` - Send daily status report

## 🔐 Security Considerations

- Bot tokens stored in environment variables (not in code)
- API key optional for Paperclip (uses unauthenticated if not provided)
- HTTPS used for Telegram API calls
- No sensitive data stored locally

## 🐛 Troubleshooting

### Bot not responding to commands
1. Check if bot is running: `ps aux | grep telegram_bot`
2. Verify bot token is correct
3. Verify chat ID is correct
4. Check for error logs

### Paperclip API connection fails
1. Verify API is running on `http://127.0.0.1:3100`
2. Check Company ID is correct
3. Verify network connectivity
4. Check firewall settings

### Dependencies not found
```bash
pip3 install --upgrade python-telegram-bot requests
```

## 📈 Monitoring & Logs

Bot logs to stdout. To persist logs:
```bash
./run_telegram_bot.sh > bot.log 2>&1 &
tail -f bot.log
```

## 🔄 Updating the Bot

To update bot features:
1. Edit `telegram_bot.py` or `telegram_news_alerts.py`
2. Stop current bot instance
3. Restart with `./run_telegram_bot.sh`

No database migrations needed - bot is stateless.

## 📞 Support & Contact

For issues or feature requests:
- Check `/help` in Telegram for command list
- Review this documentation
- Check bot logs for error messages
- Contact CTO for API issues

## 📝 Development Notes

### Adding New Commands
1. Add command handler in `main()`
2. Define handler function with `async def handler(update, context)`
3. Test with bot running

### Adding Q&A Entries
Edit the `qa_db` dictionary in `handle_question()` function:
```python
qa_db = {
    "keyword": "Answer text",
    "another": "Another answer"
}
```

### Extending Features
- Use `CallbackQueryHandler` for button interactions
- Use `ConversationHandler` for multi-step flows
- Use `filters` for message filtering

## 📦 Version History

- **v1.0** (2026-04-13)
  - Initial release with Paperclip integration
  - Status queries, work instructions, Q&A, news alerts
  - Button-based navigation
  - Conversation flows

---

**Last Updated**: 2026-04-13
**Status**: ✅ Active
