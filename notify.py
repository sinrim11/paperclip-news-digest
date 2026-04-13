#!/usr/bin/env python3
"""Paperclip issue completion notifier via Telegram."""
import json, urllib.request, os

BOT_TOKEN = "REDACTED-ROTATED-TELEGRAM-TOKEN"
CHAT_ID = "7187585050"
API = "http://127.0.0.1:3100/api"
COMPANY_ID = "64e10e8b-55f9-4792-ada5-d6ab564be978"
STATE_FILE = "/tmp/paperclip_done_count.json"

def send_telegram(text):
    data = urllib.parse.urlencode({"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"}).encode()
    urllib.request.urlopen(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage", data, timeout=10)

def get_issues():
    return json.loads(urllib.request.urlopen(f"{API}/companies/{COMPANY_ID}/issues", timeout=5).read())

def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except:
        return {"done_ids": []}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

def check_and_notify():
    issues = get_issues()
    done_now = [i for i in issues if i.get("status") == "done"]
    done_ids_now = {i["id"] for i in done_now}

    state = load_state()
    prev_ids = set(state.get("done_ids", []))

    new_done = [i for i in done_now if i["id"] not in prev_ids]

    if new_done:
        for i in new_done:
            title = i.get("title", "?")
            total_done = len(done_ids_now)
            total = len(issues)
            msg = f"<b>Paperclip 작업 완료!</b>\n\n{title}\n\n진행: {total_done}/{total} done"
            try:
                send_telegram(msg)
            except:
                pass

    save_state({"done_ids": list(done_ids_now)})
    return len(new_done)

if __name__ == "__main__":
    import urllib.parse
    n = check_and_notify()
    if n:
        print(f"Notified {n} new completion(s)")
    else:
        print("No new completions")
