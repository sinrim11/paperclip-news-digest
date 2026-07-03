#!/usr/bin/env python3
"""
Enhanced Telegram bot for News Digest + Paperclip integration.
Features: Paperclip status queries, work delegation, Q&A, news alerts.
"""
import os
import json
import asyncio
import urllib.request
import urllib.parse
from datetime import datetime
from typing import Optional, Dict, Any
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, ConversationHandler, CallbackQueryHandler

# Configuration
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "REDACTED-ROTATED-TELEGRAM-TOKEN")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "7187585050")
PAPERCLIP_API = os.getenv("PAPERCLIP_API_URL", "http://127.0.0.1:3100/api")
PAPERCLIP_COMPANY_ID = os.getenv("PAPERCLIP_COMPANY_ID", "64e10e8b-55f9-4792-ada5-d6ab564be978")
PAPERCLIP_API_KEY = os.getenv("PAPERCLIP_API_KEY", "")

# State for conversation flows
ASK_QUESTION = 1

def fetch_json(url: str, data: Optional[Dict] = None, method: Optional[str] = None, headers: Optional[Dict] = None) -> Any:
    """Fetch and parse JSON from API endpoint. Supports GET, POST, PATCH."""
    try:
        body = json.dumps(data).encode() if data else None
        if method is None:
            method = "POST" if data else "GET"
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        resp = urllib.request.urlopen(req, timeout=10)
        return json.loads(resp.read().decode())
    except Exception as e:
        return {"error": str(e)}

def get_paperclip_status() -> Dict[str, Any]:
    """Get Paperclip issue status and statistics."""
    url = f"{PAPERCLIP_API}/companies/{PAPERCLIP_COMPANY_ID}/issues"
    headers = {}
    if PAPERCLIP_API_KEY:
        headers["Authorization"] = f"Bearer {PAPERCLIP_API_KEY}"

    data = fetch_json(url, headers=headers)

    if "error" in data:
        return {"status": "error", "message": data.get("error")}

    issues = data if isinstance(data, list) else data.get("issues", [])

    stats = {
        "total": len(issues),
        "done": len([i for i in issues if i.get("status") == "done"]),
        "in_progress": len([i for i in issues if i.get("status") == "in_progress"]),
        "todo": len([i for i in issues if i.get("status") == "todo"]),
        "blocked": len([i for i in issues if i.get("status") == "blocked"]),
    }

    return {
        "status": "ok",
        "stats": stats,
        "issues": issues
    }

def format_status_message(status_data: Dict[str, Any]) -> str:
    """Format Paperclip status into readable message."""
    if status_data.get("status") == "error":
        return f"❌ Paperclip 조회 실패: {status_data.get('message')}"

    stats = status_data.get("stats", {})
    total = stats.get("total", 0)
    done = stats.get("done", 0)
    active = stats.get("in_progress", 0)
    todo = stats.get("todo", 0)
    blocked = stats.get("blocked", 0)

    progress = f"{done}/{total}" if total > 0 else "0/0"
    pct = int((done / total * 100)) if total > 0 else 0

    msg = f"""
📊 <b>Paperclip 상태</b>
━━━━━━━━━━━━━━━━━━━━━━
✅ 완료: {done}
🔄 진행: {active}
📝 TODO: {todo}
🚫 블록: {blocked}
─────────────────────
📈 진행률: {progress} ({pct}%)
━━━━━━━━━━━━━━━━━━━━━━
🕐 마지막 업데이트: {datetime.now().strftime('%H:%M:%S')}
"""
    return msg.strip()

def get_work_instructions() -> str:
    """Get work instructions and delegation info."""
    msg = """
<b>📋 업무 지시사항</b>
━━━━━━━━━━━━━━━━━━━━━━

<b>Engineer (현재 역할)</b>
• News Digest 수집, 요약, 생성
• Telegram 봇 고도화 (CMP-56)
• Paperclip 통합 및 상태 조회

<b>우선순위</b>
1️⃣ CMP-56: 텔레그램 봇 고도화
2️⃣ CMP-54: 언블록 및 진행
3️⃣ 일일 뉴스 다이제스트 생성

<b>팀 연락처</b>
👨‍💼 CTO: 지시사항 및 검토
📱 Telegram: 실시간 알림

<b>명령어</b>
/status - 작업 상태 조회
/help - 도움말
/news - 뉴스 알림 설정
/ask - 질문하기
"""
    return msg.strip()

def get_help_message() -> str:
    """Get help message with available commands."""
    msg = """
<b>🤖 News Digest Bot - 명령어</b>
━━━━━━━━━━━━━━━━━━━━━━

<b>/status</b>
Paperclip 작업 상태 조회

<b>/agents</b>
에이전트 목록 및 상태 조회

<b>/task</b> &lt;제목&gt;
새 태스크 생성 (CEO 할당)

<b>/assign</b> &lt;이슈키&gt; &lt;에이전트명&gt;
이슈를 에이전트에게 할당

<b>/instructions</b>
현재 업무 지시사항 확인

<b>/news</b>
뉴스 알림 설정

<b>/ask</b>
일반 질문 하기

<b>/help</b>
이 도움말 표시

━━━━━━━━━━━━━━━━━━━━━━
💡 팁: 명령어 후 스페이스를 눌러서
자동완성을 확인하세요!
"""
    return msg.strip()

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start command."""
    user = update.effective_user
    msg = f"""
안녕하세요 {user.first_name}! 👋

News Digest Bot에 오신 것을 환영합니다.
Paperclip 작업 상태, 뉴스 알림, 일반 질문을 지원합니다.

/help 를 입력하여 사용 가능한 명령어를 확인하세요.
"""
    await update.message.reply_text(msg.strip())

async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /status command - show Paperclip status."""
    status_data = get_paperclip_status()
    msg = format_status_message(status_data)

    keyboard = [
        [InlineKeyboardButton("🔄 새로고침", callback_data="refresh_status")],
        [InlineKeyboardButton("📋 지시사항", callback_data="instructions")],
        [InlineKeyboardButton("❓ 질문", callback_data="ask_question")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(msg, parse_mode="HTML", reply_markup=reply_markup)

async def instructions_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /instructions command - show work instructions."""
    msg = get_work_instructions()
    await update.message.reply_text(msg, parse_mode="HTML")

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /help command - show available commands."""
    msg = get_help_message()
    await update.message.reply_text(msg, parse_mode="HTML")

async def news_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /news command - manage news alerts."""
    keyboard = [
        [InlineKeyboardButton("✅ 알림 켜기", callback_data="news_on")],
        [InlineKeyboardButton("❌ 알림 끄기", callback_data="news_off")],
        [InlineKeyboardButton("📊 상태 확인", callback_data="news_status")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    msg = """
<b>📰 뉴스 알림 설정</b>
━━━━━━━━━━━━━━━━━━━━━━

아래에서 뉴스 알림을 설정하세요.

현재 상태: ✅ 활성화
"""
    await update.message.reply_text(msg, parse_mode="HTML", reply_markup=reply_markup)

async def ask_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /ask command - start Q&A conversation."""
    msg = """
<b>❓ 질문하기</b>
━━━━━━━━━━━━━━━━━━━━━━

무엇을 궁금해하세요?
(예: "텔레그램 봇은 어떻게 작동하나?")

또는 /cancel 을 입력하여 취소합니다.
"""
    await update.message.reply_text(msg, parse_mode="HTML")
    return ASK_QUESTION

async def handle_question(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle user question - provide answer from Q&A knowledge base."""
    question = update.message.text.lower()

    # Simple Q&A knowledge base
    qa_db = {
        "텔레그램 봇": "텔레그램 봇은 Paperclip 작업 상태, 뉴스 알림, 일반 질문을 처리합니다.",
        "뉴스 다이제스트": "매일 설정된 시간에 주요 뉴스를 수집하고 요약하여 전달합니다.",
        "paperclip": "Paperclip은 작업 관리 및 에이전트 조율 시스템입니다.",
        "작업": "진행 중인 작업은 /status 명령으로 확인할 수 있습니다.",
        "도움": "사용 가능한 명령어는 /help를 입력하세요.",
    }

    answer = "죄송하지만 해당 질문에 대한 답변이 없습니다.\n\n"

    for keyword, response in qa_db.items():
        if keyword in question:
            answer = response
            break

    if answer == "죄송하지만 해당 질문에 대한 답변이 없습니다.\n\n":
        answer += "다른 질문을 해보세요: /ask"

    await update.message.reply_text(answer)
    return ConversationHandler.END

async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel conversation."""
    await update.message.reply_text("❌ 취소되었습니다.")
    return ConversationHandler.END

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle button callbacks."""
    query = update.callback_query
    await query.answer()

    data = query.data

    if data == "refresh_status":
        status_data = get_paperclip_status()
        msg = format_status_message(status_data)
        keyboard = [
            [InlineKeyboardButton("🔄 새로고침", callback_data="refresh_status")],
            [InlineKeyboardButton("📋 지시사항", callback_data="instructions")],
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        await query.edit_message_text(msg, parse_mode="HTML", reply_markup=reply_markup)

    elif data == "instructions":
        msg = get_work_instructions()
        keyboard = [[InlineKeyboardButton("⬅️ 뒤로", callback_data="back_to_status")]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        await query.edit_message_text(msg, parse_mode="HTML", reply_markup=reply_markup)

    elif data == "back_to_status":
        status_data = get_paperclip_status()
        msg = format_status_message(status_data)
        keyboard = [
            [InlineKeyboardButton("🔄 새로고침", callback_data="refresh_status")],
            [InlineKeyboardButton("📋 지시사항", callback_data="instructions")],
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        await query.edit_message_text(msg, parse_mode="HTML", reply_markup=reply_markup)

    elif data == "news_on":
        await query.edit_message_text("✅ 뉴스 알림이 활성화되었습니다.")

    elif data == "news_off":
        await query.edit_message_text("❌ 뉴스 알림이 비활성화되었습니다.")

    elif data == "news_status":
        await query.edit_message_text("📊 뉴스 알림 상태: ✅ 활성화")

async def agents_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /agents command - list all agents and their status."""
    url = f"{PAPERCLIP_API}/companies/{PAPERCLIP_COMPANY_ID}/agents"
    data = fetch_json(url)
    agents = data if isinstance(data, list) else data.get("agents", [])

    if not agents or "error" in data:
        await update.message.reply_text("❌ 에이전트 목록을 불러올 수 없습니다.")
        return

    status_emoji = {"running": "🟢", "idle": "⚪", "error": "🔴"}
    lines = ["<b>🤖 에이전트 목록</b>", "━━━━━━━━━━━━━━━━━━━━━━"]
    for a in agents:
        emoji = status_emoji.get(a.get("status", ""), "⚪")
        lines.append(f"{emoji} <b>{a['name']}</b> — {a.get('status', 'unknown')}")
    lines.append(f"━━━━━━━━━━━━━━━━━━━━━━\n🕐 {datetime.now().strftime('%H:%M:%S')}")
    await update.message.reply_text("\n".join(lines), parse_mode="HTML")


async def task_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /task <title> - create a new task assigned to CEO."""
    if not context.args:
        await update.message.reply_text("사용법: /task <제목>\n예: /task 뉴스 소스 추가")
        return

    title = " ".join(context.args)
    url = f"{PAPERCLIP_API}/companies/{PAPERCLIP_COMPANY_ID}/issues"
    payload = {
        "title": title,
        "status": "todo",
        "assigneeAgentId": "4a7ea2fd-4426-41ad-ad94-1063dd03bf6c",
        "projectKey": "CMP",
    }
    result = fetch_json(url, data=payload)

    if "error" in result:
        await update.message.reply_text(f"❌ 생성 실패: {result['error']}")
        return

    key = result.get("key", result.get("id", "?")[:8])
    await update.message.reply_text(f"✅ 태스크 생성: <b>{key}</b> — {title}", parse_mode="HTML")


async def assign_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /assign <issue_key> <agent_name> - assign issue to agent."""
    if not context.args or len(context.args) < 2:
        await update.message.reply_text("사용법: /assign <이슈키> <에이전트명>\n예: /assign CMP-72 CTO")
        return

    issue_key = context.args[0].upper()
    agent_name = context.args[1]

    # Resolve agent by name
    agents_data = fetch_json(f"{PAPERCLIP_API}/companies/{PAPERCLIP_COMPANY_ID}/agents")
    agents = agents_data if isinstance(agents_data, list) else agents_data.get("agents", [])
    agent = next((a for a in agents if a["name"].lower() == agent_name.lower()), None)
    if not agent:
        names = ", ".join(a["name"] for a in agents)
        await update.message.reply_text(f"❌ 에이전트 '{agent_name}' 없음\n사용 가능: {names}")
        return

    # Resolve issue by key
    issues_data = fetch_json(f"{PAPERCLIP_API}/companies/{PAPERCLIP_COMPANY_ID}/issues?limit=200")
    issues = issues_data if isinstance(issues_data, list) else issues_data.get("issues", [])
    issue = next((i for i in issues if i.get("key") == issue_key), None)
    if not issue:
        await update.message.reply_text(f"❌ 이슈 '{issue_key}' 없음")
        return

    result = fetch_json(f"{PAPERCLIP_API}/issues/{issue['id']}", data={"assigneeAgentId": agent["id"]}, method="PATCH")
    if "error" in result:
        await update.message.reply_text(f"❌ 할당 실패: {result['error']}")
        return

    await update.message.reply_text(
        f"✅ <b>{issue_key}</b> → <b>{agent['name']}</b> 할당 완료", parse_mode="HTML"
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle plain text messages."""
    if update.message:
        text = update.message.text.lower()

        # Check for keywords
        if "상태" in text or "status" in text:
            await status_command(update, context)
        elif "지시" in text or "instruction" in text:
            await instructions_command(update, context)
        elif "뉴스" in text or "news" in text:
            await news_command(update, context)
        else:
            # Default response
            await update.message.reply_text(
                "명령어를 입력하세요:\n/status - 상태 조회\n/help - 도움말"
            )

def main() -> None:
    """Start the bot."""
    application = Application.builder().token(BOT_TOKEN).build()

    # Command handlers
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("status", status_command))
    application.add_handler(CommandHandler("agents", agents_command))
    application.add_handler(CommandHandler("task", task_command))
    application.add_handler(CommandHandler("assign", assign_command))
    application.add_handler(CommandHandler("instructions", instructions_command))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("news", news_command))

    # Q&A conversation handler
    conv_handler = ConversationHandler(
        entry_points=[CommandHandler("ask", ask_command)],
        states={
            ASK_QUESTION: [MessageHandler(filters.TEXT & ~filters.COMMAND, handle_question)],
        },
        fallbacks=[CommandHandler("cancel", cancel_command)],
    )
    application.add_handler(conv_handler)

    # Button callback handler
    application.add_handler(CallbackQueryHandler(button_callback))

    # Message handler for plain text
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print("🤖 Telegram Bot starting...")
    print(f"📊 Paperclip API: {PAPERCLIP_API}")
    print(f"🏢 Company ID: {PAPERCLIP_COMPANY_ID}")

    application.run_polling(allowed_updates=[Update.ALL_TYPES])

if __name__ == "__main__":
    main()
