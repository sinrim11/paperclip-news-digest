#!/usr/bin/env python3
"""Paperclip issue event notifier via Telegram.

Fires on any meaningful state transition: done, in_progress, todo→created, cancelled, blocked.
State file tracks (id → status) snapshot; diff against it to find transitions.
"""
import json, urllib.request, urllib.parse

BOT_TOKEN = "REDACTED-ROTATE-ME"
CHAT_ID = "7187585050"
API = "http://127.0.0.1:3100/api"
COMPANY_ID = "64e10e8b-55f9-4792-ada5-d6ab564be978"
STATE_FILE = "/tmp/paperclip_issue_state.json"
LEGACY_STATE_FILE = "/tmp/paperclip_done_count.json"  # migrated on first run

EMOJI = {
    "done": "✅",
    "in_progress": "▶️",
    "todo": "➕",
    "cancelled": "🚫",
    "blocked": "🛑",
    "backlog": "📥",
}

def send_telegram(text):
    data = urllib.parse.urlencode({"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"}).encode()
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage", data, timeout=10)
        return True
    except Exception:
        return False

def get_issues():
    return json.loads(urllib.request.urlopen(f"{API}/companies/{COMPANY_ID}/issues", timeout=5).read())

def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return None

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

def build_snapshot(issues):
    return {i["id"]: {"status": i.get("status"), "identifier": i.get("identifier", "?"), "title": (i.get("title") or "")[:100]} for i in issues}

def fmt_event(kind, cur, total_done, total):
    em = EMOJI.get(kind, "•")
    head = {
        "done": "작업 완료",
        "in_progress": "작업 시작",
        "todo": "새 이슈",
        "cancelled": "이슈 취소",
        "blocked": "이슈 블록",
        "backlog": "백로그 이동",
    }.get(kind, kind)
    return f"<b>{em} {head}</b>\n{cur['identifier']}: {cur['title']}\n진행: {total_done}/{total}"

def check_and_notify():
    issues = get_issues()
    cur = build_snapshot(issues)
    prev = load_state()

    # first-run migration: adopt current snapshot without spamming
    if prev is None:
        save_state(cur)
        return 0, "initialized (no events sent on first run)"

    total = len(issues)
    total_done = sum(1 for v in cur.values() if v["status"] == "done")
    events = []

    # detect new issues (id in cur but not prev)
    for iid, v in cur.items():
        if iid not in prev:
            events.append(("todo" if v["status"] == "todo" else v["status"], v))
        else:
            pv = prev[iid].get("status")
            nv = v.get("status")
            if pv != nv:
                # transition — fire on new status (but skip noisy intermediates)
                if nv in ("done", "cancelled", "blocked"):
                    events.append((nv, v))
                elif nv == "in_progress" and pv in ("todo", "backlog"):
                    events.append(("in_progress", v))
                elif nv == "todo" and pv == "backlog":
                    events.append(("todo", v))

    sent = 0
    for kind, v in events:
        msg = fmt_event(kind, v, total_done, total)
        if send_telegram(msg):
            sent += 1

    save_state(cur)
    return sent, f"{len(events)} events, {sent} sent"

if __name__ == "__main__":
    n, info = check_and_notify()
    print(f"notify: {info}")
