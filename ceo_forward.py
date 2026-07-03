#!/usr/bin/env python3
"""
ceo_forward.py — Poll CMP-78 for new CEO comments and forward to Telegram.

Runs as a blocking daemon (30s poll interval).
State persisted in ~/.telegram_liaison_state.json (last_seen_iso).
"""

import json
import os
import signal
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

# Reuse config constants from the bridge (avoid duplication)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from telegram_bridge import _get, API_BASE, INBOX_ISSUE_ID, CEO_AGENT_ID

# Telegram
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "REDACTED-ROTATED-TELEGRAM-TOKEN")
CHAT_ID = "7187585050"
TG_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

# State file
STATE_FILE = os.path.expanduser("~/news-digest/.telegram_liaison_state.json")

# Timing
POLL_INTERVAL = 30       # seconds between polls
ERROR_WAIT = 60          # seconds to wait after an error
MAX_TG_LEN = 4096        # Telegram message length limit

KST = timezone(timedelta(hours=9))

_running = True


def _signal_handler(sig, frame):
    global _running
    print(f"[ceo_forward] Received signal {sig}, shutting down gracefully.", flush=True)
    _running = False


def _load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_state(state: dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _tg_send(text: str):
    """Send a message to Telegram, splitting if over 4096 chars."""
    chunks = [text[i:i + MAX_TG_LEN] for i in range(0, len(text), MAX_TG_LEN)]
    for chunk in chunks:
        payload = json.dumps({
            "chat_id": CHAT_ID,
            "text": chunk,
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{TG_API}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = json.loads(r.read())
            if not resp.get("ok"):
                raise RuntimeError(f"Telegram error: {resp}")


def _format_comment(comment: dict, issue_id: str = "") -> str:
    created_at = comment.get("createdAt", "")
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00")).astimezone(KST)
        ts = dt.strftime("%Y-%m-%d %H:%M KST")
    except Exception:
        ts = created_at

    body = comment.get("body", "").strip()
    issue_tag = f" ({issue_id})" if issue_id else ""
    return f"[CEO{issue_tag}]\n{ts}\n\n{body}"


COMPANY_ID = "64e10e8b-55f9-4792-ada5-d6ab564be978"


def _get_all_ceo_comments_since(since_iso: str) -> list:
    """Fetch CEO comments across ALL issues since a given timestamp."""
    try:
        issues = _get(f"/companies/{COMPANY_ID}/issues", {"limit": "50"})
    except Exception as e:
        print(f"[ceo_forward] Failed to fetch issues: {e}", flush=True)
        return []

    try:
        since_dt = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
    except Exception:
        since_dt = datetime.min.replace(tzinfo=timezone.utc)

    results = []
    for issue in issues:
        iid = issue.get("id")
        identifier = issue.get("identifier", "?")
        try:
            comments = _get(f"/issues/{iid}/comments")
        except Exception:
            continue
        for c in comments:
            if c.get("authorAgentId") != CEO_AGENT_ID:
                continue
            created = c.get("createdAt", "")
            try:
                created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            except Exception:
                continue
            if created_dt > since_dt:
                results.append((created_dt, c, identifier))

    results.sort(key=lambda x: x[0])
    return results


def _init_seen() -> str:
    """On first start: use current time as baseline (don't replay old comments)."""
    now = datetime.now(timezone.utc).isoformat()
    print(f"[ceo_forward] Init: marking all existing comments as seen. Baseline: {now}", flush=True)
    return now


def _poll_once(last_seen_iso: str) -> str:
    """
    Fetch CEO comments across ALL issues, forward new ones to Telegram.
    Returns the updated last_seen_iso.
    """
    new_comments = _get_all_ceo_comments_since(last_seen_iso)

    for created_dt, c, identifier in new_comments:
        msg = _format_comment(c, identifier)
        try:
            _tg_send(msg)
            print(f"[ceo_forward] Forwarded {identifier} comment {c.get('id', '')[:8]} created {c.get('createdAt')}", flush=True)
        except Exception as e:
            print(f"[ceo_forward] Telegram send failed: {e}", flush=True)
        last_seen_iso = c.get("createdAt", last_seen_iso)

    return last_seen_iso


def main():
    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    print(f"[ceo_forward] Starting. State file: {STATE_FILE}", flush=True)

    state = _load_state()
    last_seen_iso = state.get("last_seen_iso")

    if not last_seen_iso:
        last_seen_iso = _init_seen()
        state["last_seen_iso"] = last_seen_iso
        _save_state(state)

    print(f"[ceo_forward] Polling every {POLL_INTERVAL}s. Last seen: {last_seen_iso}", flush=True)

    while _running:
        try:
            new_last = _poll_once(last_seen_iso)
            if new_last != last_seen_iso:
                last_seen_iso = new_last
                state["last_seen_iso"] = last_seen_iso
                _save_state(state)
            wait = POLL_INTERVAL
        except Exception as e:
            print(f"[ceo_forward] Error: {e}", flush=True)
            wait = ERROR_WAIT

        # Sleep in 1s increments so SIGTERM wakes us quickly
        for _ in range(wait):
            if not _running:
                break
            time.sleep(1)

    print("[ceo_forward] Stopped.", flush=True)


if __name__ == "__main__":
    main()
