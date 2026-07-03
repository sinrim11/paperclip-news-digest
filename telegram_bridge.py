#!/usr/bin/env python3
"""
Telegram Liaison Bridge Tools for Paperclip CEO monitoring.
Usage: python3 telegram_bridge.py <tool_name> [args...]

Tools:
  pc_snapshot                          - Company-wide status snapshot
  pc_ceo_activity [last_n]             - CEO's recent comments (default 10)
  pc_active_run_tail [max_events]      - Recent activity events (default 20)
  pc_recent_completions [since_iso]    - Completed issues since timestamp
  pc_send_to_ceo <message>             - Post message to Telegram Inbox issue
"""

import sys
import json
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

# Config
API_BASE = "http://localhost:3100/api"
COMPANY_ID = "64e10e8b-55f9-4792-ada5-d6ab564be978"
CEO_AGENT_ID = "4a7ea2fd-4426-41ad-ad94-1063dd03bf6c"
INBOX_ISSUE_ID = "81695923-fadf-45f2-85a5-d9f8d31d1e76"
INBOX_IDENTIFIER = "CMP-78"


def _get(path: str, params: dict = None) -> any:
    url = f"{API_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def _post(path: str, body: dict) -> any:
    url = f"{API_BASE}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def pc_snapshot() -> dict:
    """Company-wide status snapshot."""
    issues = _get(f"/companies/{COMPANY_ID}/issues", {"limit": 200})

    counts = {"total": len(issues), "done": 0, "in_progress": 0, "todo": 0,
              "blocked": 0, "backlog": 0, "cancelled": 0}
    active_issue = None

    for issue in issues:
        status = issue.get("status", "")
        if status in counts:
            counts[status] += 1

        if (status == "in_progress" and
                issue.get("assigneeAgentId") == CEO_AGENT_ID and
                active_issue is None):
            active_issue = {
                "id": issue["id"],
                "identifier": issue.get("identifier"),
                "title": issue["title"],
                "assignee": "CEO",
            }

    return {
        "total": counts["total"],
        "done": counts["done"],
        "in_progress": counts["in_progress"],
        "todo": counts["todo"],
        "blocked": counts["blocked"],
        "backlog": counts["backlog"],
        "cancelled": counts["cancelled"],
        "active_ceo_issue": active_issue,
    }


def pc_ceo_activity(last_n: int = 10) -> list:
    """CEO's recent comments."""
    activity = _get(f"/companies/{COMPANY_ID}/activity", {
        "limit": last_n * 3,  # over-fetch to filter by CEO
    })

    results = []
    for event in activity:
        if event.get("actorId") != CEO_AGENT_ID:
            continue
        action = event.get("action", "")
        if "comment" not in action and "status" not in action and "issue" not in action:
            continue
        details = event.get("details") or {}
        results.append({
            "action": action,
            "issue_id": event.get("entityId"),
            "issue_title": details.get("issueTitle", details.get("title", "")),
            "identifier": details.get("identifier", ""),
            "body_snippet": details.get("bodySnippet", ""),
            "created_at": event.get("createdAt"),
        })
        if len(results) >= last_n:
            break

    return results


def pc_active_run_tail(max_events: int = 20) -> list:
    """Recent company activity events (CEO actions in last hour)."""
    activity = _get(f"/companies/{COMPANY_ID}/activity", {"limit": max_events})

    results = []
    for event in activity:
        actor_id = event.get("actorId") or ""
        action = event.get("action", "")
        details = event.get("details") or {}
        results.append({
            "actor": "CEO" if actor_id == CEO_AGENT_ID else (actor_id[:8] + "..." if actor_id else "unknown"),
            "action": action,
            "entity_type": event.get("entityType"),
            "issue_title": details.get("issueTitle", details.get("title", "")),
            "identifier": details.get("identifier", ""),
            "body_snippet": details.get("bodySnippet", "")[:200] if details.get("bodySnippet") else "",
            "created_at": event.get("createdAt"),
        })

    return results


def pc_recent_completions(since_iso: str = None) -> list:
    """Issues completed since given ISO timestamp (or last 24h if not given)."""
    issues = _get(f"/companies/{COMPANY_ID}/issues", {
        "status": "done",
        "limit": 50,
    })

    if since_iso:
        try:
            since_dt = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
        except ValueError:
            since_dt = None
    else:
        since_dt = None

    results = []
    for issue in issues:
        completed_at = issue.get("completedAt")
        if not completed_at:
            continue
        if since_dt:
            try:
                issue_dt = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                if issue_dt <= since_dt:
                    continue
            except ValueError:
                pass
        results.append({
            "id": issue["id"],
            "identifier": issue.get("identifier"),
            "title": issue["title"],
            "completed_at": completed_at,
            "assignee_agent_id": issue.get("assigneeAgentId"),
        })

    return results


def pc_budget_status() -> list:
    """Per-agent monthly budget and spend. Returns only the fields the
    Telegram bot actually cites (name / role / spent / budget / %) to
    keep the pre-fetched payload tiny — the full /agents response has
    ~1KB of adapterConfig/runtimeConfig per agent which is irrelevant
    for liaison answers.
    """
    agents = _get(f"/companies/{COMPANY_ID}/agents")
    results = []
    for a in agents:
        budget_cents = a.get("budgetMonthlyCents") or 0
        spent_cents = a.get("spentMonthlyCents") or 0
        entry = {
            "name": a.get("name", ""),
            "role": a.get("role", ""),
            "status": a.get("status", ""),
            "spent_usd": round(spent_cents / 100, 2),
            "budget_usd": round(budget_cents / 100, 2),
            "used_pct": (
                round(spent_cents / budget_cents * 100, 1)
                if budget_cents > 0 else None
            ),
        }
        if a.get("pausedAt"):
            entry["paused_reason"] = a.get("pauseReason") or ""
        results.append(entry)
    return results


def pc_send_to_ceo(message: str) -> dict:
    """Post a message to the Telegram Inbox issue as a comment."""
    body = f"**[텔레그램 사용자 메시지]**\n\n{message}"
    result = _post(f"/issues/{INBOX_ISSUE_ID}/comments", {"body": body})
    return {
        "comment_id": result.get("id"),
        "issue_id": INBOX_ISSUE_ID,
        "identifier": INBOX_IDENTIFIER,
        "issue_url": f"http://localhost:3100/issues/{INBOX_ISSUE_ID}",
    }


TOOLS = {
    "pc_snapshot": (pc_snapshot, []),
    "pc_ceo_activity": (pc_ceo_activity, ["last_n"]),
    "pc_active_run_tail": (pc_active_run_tail, ["max_events"]),
    "pc_recent_completions": (pc_recent_completions, ["since_iso"]),
    "pc_budget_status": (pc_budget_status, []),
    "pc_send_to_ceo": (pc_send_to_ceo, ["message"]),
}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    tool_name = sys.argv[1]
    if tool_name not in TOOLS:
        print(f"Unknown tool: {tool_name}")
        print(f"Available: {', '.join(TOOLS.keys())}")
        sys.exit(1)

    fn, param_names = TOOLS[tool_name]
    args = sys.argv[2:]

    # Build kwargs from positional args
    kwargs = {}
    for i, val in enumerate(args):
        if i < len(param_names):
            pname = param_names[i]
            # Type coerce int params
            if pname in ("last_n", "max_events"):
                kwargs[pname] = int(val)
            else:
                kwargs[pname] = val

    try:
        result = fn(**kwargs)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
