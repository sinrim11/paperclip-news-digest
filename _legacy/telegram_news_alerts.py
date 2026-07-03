#!/usr/bin/env python3
"""
Telegram news alert system - sends news digests to Telegram.
Integrates with telegram_bot.py for comprehensive messaging.
"""
import os
import json
import urllib.request
import urllib.parse
from typing import Optional, Dict, Any
from datetime import datetime

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "REDACTED-ROTATE-ME")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "7187585050")

def send_telegram_message(text: str, parse_mode: str = "HTML") -> bool:
    """Send message to Telegram chat."""
    try:
        data = urllib.parse.urlencode({
            "chat_id": CHAT_ID,
            "text": text,
            "parse_mode": parse_mode
        }).encode()

        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        urllib.request.urlopen(url, data, timeout=10)
        return True
    except Exception as e:
        print(f"❌ Telegram send failed: {e}")
        return False

def send_news_digest(digest_path: str) -> bool:
    """Send news digest file content to Telegram."""
    try:
        with open(digest_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Split into chunks if too long (Telegram limit: 4096 chars per message)
        max_chunk = 4000
        chunks = [content[i:i+max_chunk] for i in range(0, len(content), max_chunk)]

        for i, chunk in enumerate(chunks):
            header = f"📰 <b>뉴스 다이제스트</b> (Part {i+1}/{len(chunks)})\n" if len(chunks) > 1 else "📰 <b>뉴스 다이제스트</b>\n"
            message = header + "━━━━━━━━━━━━━━━━━━━━━\n" + chunk

            if not send_telegram_message(message):
                return False

        return True
    except Exception as e:
        print(f"❌ Failed to send news digest: {e}")
        return False

def send_paperclip_alert(status_type: str, issue_title: str, issue_id: str) -> bool:
    """Send Paperclip work alerts (new task, completion, etc.)."""
    alerts = {
        "new_task": f"📌 <b>새 업무!</b>\n{issue_title}\n(<code>{issue_id}</code>)",
        "task_completed": f"✅ <b>업무 완료!</b>\n{issue_title}\n(<code>{issue_id}</code>)",
        "blocked": f"🚫 <b>업무 블록됨!</b>\n{issue_title}\n(<code>{issue_id}</code>)",
    }

    message = alerts.get(status_type, f"📋 {issue_title}")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    message += f"\n\n🕐 {timestamp}"

    return send_telegram_message(message)

def send_status_report() -> bool:
    """Send daily status report to Telegram."""
    msg = f"""
📊 <b>일일 상태 리포트</b>
━━━━━━━━━━━━━━━━━━━━━━
🕐 생성 시간: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

📰 뉴스 다이제스트: ✅ 생성 완료
📋 Paperclip 업무: 정상 운영 중
🤖 텔레그램 봇: 👂 대기 중

━━━━━━━━━━━━━━━━━━━━━━
💡 /status 로 상세 정보를 확인하세요
"""
    return send_telegram_message(msg)

if __name__ == "__main__":
    # Test sending a status report
    print("📱 Sending test status report...")
    if send_status_report():
        print("✅ Test message sent successfully!")
    else:
        print("❌ Failed to send test message")
