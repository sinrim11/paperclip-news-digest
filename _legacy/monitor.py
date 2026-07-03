#!/usr/bin/env python3
"""Paperclip + LM Studio unified monitor + supervisor."""
import json, time, sys, urllib.request, datetime

API = "http://127.0.0.1:3100/api"
LMSTUDIO = "http://127.0.0.1:1234"
LMSTUDIO_V1 = f"{LMSTUDIO}/v1"
MODEL = "supergemma4-26b-uncensored-mlx-v2"
COMPANY_ID = "64e10e8b-55f9-4792-ada5-d6ab564be978"
STUCK_RUN_HARD_SECONDS = 5400  # running > 90 min → definitely stuck, cancel
STUCK_RUN_SIGNAL_SECONDS = 1800  # running > 30 min + explicit stuck signal → cancel
QUEUE_BACKLOG_THRESHOLD = 3  # queued >= 3 per agent → flag
STUCK_SIGNALS = ("Lost in-memory process handle",)
TOKEN_BUDGET_WARN = 12000  # warn at 12k input tokens
TOKEN_BUDGET_HARD = 18000  # auto-cancel + request continuation at 18k input tokens

# Claude budget envelope (USD). Each agent has own cap inside this.
CLAUDE_ENVELOPE_USD = 300
CLAUDE_ENVELOPE_WARN_USD = 250
CLAUDE_ENVELOPE_HARD_USD = 280
# Per-agent caps (uses agent name → cap). Unknown agents get default.
CLAUDE_AGENT_CAPS = {"SeniorArchitect": 150, "FrontendArchitect": 100, "CEO": 9999}
# Per-agent auto-pause threshold (% of cap)
CLAUDE_AGENT_PAUSE_PCT = 0.95  # 95% of cap → pause heartbeat

def fetch_json(url, data=None, timeout=10):
    req = urllib.request.Request(url)
    if data:
        req.add_header("Content-Type", "application/json")
        resp = urllib.request.urlopen(req, json.dumps(data).encode(), timeout=timeout)
    else:
        resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read().decode())

def check_lmstudio():
    # LM Studio does not expose VRAM via /v1 API. Just probe /v1/models + inference.
    loaded = False
    try:
        models = fetch_json(f"{LMSTUDIO_V1}/models", timeout=5)
        for m in models.get("data", []):
            if MODEL in m.get("id", ""):
                loaded = True
                break
    except Exception:
        return {"status": "DOWN", "detail": "API unreachable"}

    if not loaded:
        return {"status": "DOWN", "detail": f"model {MODEL} not loaded"}

    # Probe inference (short prompt — don't burn GPU when workers are active)
    try:
        start = time.time()
        data = fetch_json(f"{LMSTUDIO_V1}/chat/completions", {
            "model": MODEL,
            "messages": [{"role": "user", "content": "1+1="}],
            "max_tokens": 5
        }, timeout=20)
        elapsed = time.time() - start
        tokens = data.get("usage", {}).get("completion_tokens", 0)
        tps = tokens / elapsed if elapsed > 0 else 0
        return {"status": "OK", "tps": round(tps, 1), "latency": round(elapsed, 2), "vram": "-"}
    except Exception as e:
        # MLX Max Concurrent=1: inference probe may block while workers are busy
        return {"status": "BUSY", "detail": "worker using model (serialised)", "vram": "-"}

def check_agents():
    data = fetch_json(f"{API}/companies/{COMPANY_ID}/agents")
    out = []
    for a in data:
        rt = (a.get("runtimeConfig") or {}).get("heartbeat") or {}
        out.append({
            "name": a.get("name", "?"),
            "heartbeat": "ON" if rt.get("enabled") else "OFF",
            "status": a.get("status") or "unknown",
            "adapter": a.get("adapterType") or "?",
            "pauseReason": a.get("pauseReason"),
        })
    return out

def check_issues():
    data = fetch_json(f"{API}/companies/{COMPANY_ID}/issues")
    issues = data if isinstance(data, list) else data.get("issues", [])
    return {
        "total": len(issues),
        "done": sum(1 for i in issues if i.get("status") in ("done", "closed")),
        "active": sum(1 for i in issues if i.get("status") == "in_progress"),
        "todo": sum(1 for i in issues if i.get("status") == "todo"),
        "backlog": sum(1 for i in issues if i.get("status") == "backlog"),
    }

def compute_claude_costs():
    """Return dict agent_id → {name, cost_usd, cap_usd, running, queued}.
    Reads Paperclip's authoritative agents.spent_monthly_cents (auto-accumulated
    by costService after heartbeat.ts patch). Only quick queue/running snapshot
    from heartbeat-runs for operational context.
    """
    try:
        agents = fetch_json(f"{API}/companies/{COMPANY_ID}/agents")
    except Exception:
        return {}
    out = {}
    for a in agents:
        if a.get("adapterType") != "claude_local":
            continue
        aid = a.get("id")
        name = a.get("name", "?")
        spent_cents = a.get("spentMonthlyCents") or 0
        budget_cents = a.get("budgetMonthlyCents") or 0
        # Queue/running snapshot only (cheap, limit=20)
        try:
            d = fetch_json(f"{API}/companies/{COMPANY_ID}/heartbeat-runs?agentId={aid}&limit=20", timeout=5)
            runs = d if isinstance(d, list) else d.get("items") or d.get("runs") or []
        except Exception:
            runs = []
        running = sum(1 for r in runs if r.get("status") == "running")
        queued = sum(1 for r in runs if r.get("status") == "queued")
        out[aid] = {
            "name": name,
            "cost_usd": spent_cents / 100,
            "cap_usd": budget_cents / 100,
            "running": running,
            "queued": queued,
        }
    return out

def _fetch_recent_runs(agent_id, limit=8):
    try:
        data = fetch_json(f"{API}/companies/{COMPANY_ID}/heartbeat-runs?agentId={agent_id}&limit={limit}", timeout=5)
        return data if isinstance(data, list) else data.get("items") or data.get("runs") or []
    except Exception:
        return []

def _fetch_run_max_input_tokens(run_id):
    """Scan recent events for opencode step-finish chunks and return max tokens.input."""
    import re
    try:
        big = fetch_json(f"{API}/heartbeat-runs/{run_id}/events?limit=100", timeout=5)
        events = big if isinstance(big, list) else big.get("items") or big.get("events") or []
    except Exception:
        return 0
    max_in = 0
    for e in events:
        payload = e.get("payload")
        chunk = ""
        if isinstance(payload, dict):
            chunk = payload.get("chunk") or ""
        if not chunk:
            # sometimes message contains the chunk
            chunk = e.get("message") or ""
        if not chunk or "step-finish" not in chunk and "step_finish" not in chunk:
            continue
        # regex for "input":NNN inside tokens object
        for m in re.finditer(r'"input"\s*:\s*(\d+)', chunk):
            try:
                v = int(m.group(1))
                if v > max_in:
                    max_in = v
            except Exception:
                pass
    return max_in

def _fetch_run_last_event_age(run_id):
    """Return seconds since last event on a run, or None if no events / fetch fails."""
    try:
        data = fetch_json(f"{API}/heartbeat-runs/{run_id}/events?limit=1&order=desc", timeout=5)
        events = data if isinstance(data, list) else data.get("items") or data.get("events") or []
        if not events:
            return None
        # API returns oldest first by default; fetch larger window and take max createdAt
        big = fetch_json(f"{API}/heartbeat-runs/{run_id}/events?limit=50", timeout=5)
        big_list = big if isinstance(big, list) else big.get("items") or big.get("events") or []
        if not big_list:
            return None
        latest = max(big_list, key=lambda e: e.get("createdAt",""))
        ts = latest.get("createdAt","")
        dt = datetime.datetime.fromisoformat(ts.replace("Z","+00:00"))
        now = datetime.datetime.now(datetime.timezone.utc)
        return (now - dt).total_seconds()
    except Exception:
        return None

def _cancel_run(run_id):
    url = f"{API}/heartbeat-runs/{run_id}/cancel"
    req = urllib.request.Request(url, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, b"{}", timeout=10)
        return resp.status in (200, 201, 204)
    except Exception:
        return False

def supervise_runs(agents):
    """Auto-detect and auto-cancel stuck runs; report queue backlogs & error patterns."""
    now = datetime.datetime.now(datetime.timezone.utc)
    actions = []  # (level, message)
    agents_by_name = {a["name"]: a for a in agents}
    for a in agents:
        if a["adapter"] != "opencode_local":
            continue
        # Agent IDs are stored in the agents API — need to refetch with id
    # single fetch to get agent ids:
    try:
        full = fetch_json(f"{API}/companies/{COMPANY_ID}/agents")
    except Exception as e:
        return [("error", f"supervisor: failed to fetch agents: {e}")]
    for a in full:
        if a.get("adapterType") != "opencode_local":
            continue
        aid = a.get("id")
        name = a.get("name","?")
        runs = _fetch_recent_runs(aid, limit=8)
        if not runs:
            continue
        queued = [r for r in runs if r.get("status") == "queued"]
        running = [r for r in runs if r.get("status") == "running"]
        failed_recent = [r for r in runs[:5] if r.get("status") == "failed"]
        # 1) Stuck running detection
        for r in running:
            started = r.get("startedAt") or r.get("createdAt") or ""
            err = (r.get("error") or "")
            try:
                dt = datetime.datetime.fromisoformat(started.replace("Z","+00:00"))
                age = (now - dt).total_seconds()
            except Exception:
                age = 0
            has_stuck_signal = any(sig in err for sig in STUCK_SIGNALS)
            cancel_reason = None
            # (0) Token budget exceeded — highest priority, catches context-overflow hangs
            max_in = _fetch_run_max_input_tokens(r.get("id"))
            if max_in >= TOKEN_BUDGET_HARD:
                cancel_reason = f"token-overflow input={max_in} (>={TOKEN_BUDGET_HARD})"
            elif max_in >= TOKEN_BUDGET_WARN:
                actions.append(("warn", f"{name}: run {r.get('id','?')[:8]} input tokens={max_in} approaching budget {TOKEN_BUDGET_HARD}"))
            # (a) explicit stuck signal + age > 30min
            if not cancel_reason and has_stuck_signal and age > STUCK_RUN_SIGNAL_SECONDS:
                cancel_reason = f"signal={err[:50]!r}"
            # (b) hard timeout 90min
            elif not cancel_reason and age > STUCK_RUN_HARD_SECONDS:
                cancel_reason = f"hard-timeout age={int(age)}s"
            # (c) inference hang: run age > 30min AND last event age > 25min (no progress)
            elif not cancel_reason and age > STUCK_RUN_SIGNAL_SECONDS:
                ev_age = _fetch_run_last_event_age(r.get("id"))
                # Events API can 500 on some runs; treat None as stale evidence when age > 45min
                if ev_age is not None and ev_age > 1500:
                    cancel_reason = f"inference-hang last_event={int(ev_age)}s ago"
                elif ev_age is None and age > 2700:  # 45min running + events unavailable
                    cancel_reason = f"events-unavailable age={int(age)}s (defensive cancel)"
                else:
                    actions.append(("info", f"{name}: long-running run {r.get('id','?')[:8]} age={int(age//60)}m (last-event {int((ev_age or 0)//60)}m ago)"))
            if cancel_reason:
                ok = _cancel_run(r.get("id"))
                actions.append(("fix" if ok else "error",
                    f"{name}: auto-cancel stuck run {r.get('id','?')[:8]} (age={int(age)}s, {cancel_reason}) → {'OK' if ok else 'FAILED'}"))
        # 2) Queue backlog
        if len(queued) >= QUEUE_BACKLOG_THRESHOLD:
            actions.append(("warn", f"{name}: queue backlog = {len(queued)} (may indicate blocked run ahead)"))
        # 3) Repeating failure pattern
        if len(failed_recent) >= 3:
            errs = [((r.get('error') or '')[:60]) for r in failed_recent]
            # if all errors start with same prefix
            if len(set(errs)) == 1:
                actions.append(("warn", f"{name}: {len(failed_recent)} recent failed runs all with error: {errs[0]!r}"))
            else:
                actions.append(("info", f"{name}: {len(failed_recent)} recent failed runs (varying errors)"))
    return actions

if __name__ == "__main__":
    print("=" * 60)
    print(f"  Monitor @ {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    try:
        o = check_lmstudio()
        s = o["status"]
        if s == "OK":
            # MLX Max Concurrent=1: probe under contention looks slow, that's normal.
            try:
                _agents_snapshot = check_agents()
                _running_workers = sum(1 for a in _agents_snapshot if a['status']=='running' and a['adapter']=='opencode_local')
            except Exception:
                _running_workers = 0
            if o["tps"] > 10:
                tag = "OK"
            elif o["tps"] > 3:
                tag = "SLOW"
            elif _running_workers >= 1:
                tag = f"SATURATED ({_running_workers} worker busy — MLX serial)"
            else:
                tag = "CRITICAL"
            print(f"\n[LM Studio] {tag} | {o['tps']} TPS | {o['latency']}s")
        elif s == "BUSY":
            print(f"\n[LM Studio] BUSY (worker using model — MLX serial)")
        else:
            print(f"\n[LM Studio] DOWN - {o.get('detail','?')}")
    except Exception as e:
        print(f"\n[LM Studio] ERROR - {e}")

    try:
        agents = check_agents()
        print(f"\n[Agents]")
        for a in agents:
            flag = " 🚩" if a['status'] in ('error','paused') or a['pauseReason'] else ""
            pr = f" paused={a['pauseReason']}" if a['pauseReason'] else ""
            print(f"  {a['name']:10s} hb={a['heartbeat']:3s} status={a['status']:10s} adapter={a['adapter']}{pr}{flag}")
    except Exception as e:
        print(f"\n[Agents] ERROR - {e}")

    try:
        issues = check_issues()
        print(f"\n[Issues] Total:{issues['total']} Done:{issues['done']} Active:{issues['active']} Todo:{issues['todo']} Backlog:{issues['backlog']}")
    except Exception as e:
        print(f"\n[Issues] ERROR - {e}")

    try:
        claude_costs = compute_claude_costs()
        total_usd = sum(c["cost_usd"] for c in claude_costs.values() if c["name"] != "CEO")
        print(f"\n[Claude Cost]")
        for aid, c in claude_costs.items():
            pct = (c["cost_usd"] / c["cap_usd"] * 100) if c["cap_usd"] else 0
            flag = " 🚩" if pct >= 95 else " ⚠️" if pct >= 80 else ""
            print(f"  {c['name']:18} ${c['cost_usd']:6.2f}/${c['cap_usd']:<6.0f} ({pct:4.1f}%) run={c['running']} queue={c['queued']}{flag}")
        envelope_flag = " 🚩 HARD" if total_usd >= CLAUDE_ENVELOPE_HARD_USD else " ⚠️ WARN" if total_usd >= CLAUDE_ENVELOPE_WARN_USD else ""
        print(f"  {'ENVELOPE (SA+FA)':18} ${total_usd:6.2f}/${CLAUDE_ENVELOPE_USD - CLAUDE_AGENT_CAPS.get('CEO', 0) if CLAUDE_AGENT_CAPS.get('CEO', 9999) < 9999 else 250}{envelope_flag}")
    except Exception as e:
        print(f"\n[Claude Cost] ERROR - {e}")

    try:
        actions = supervise_runs(agents)
        if actions:
            print(f"\n[Supervisor]")
            for level, msg in actions:
                tag = {"fix":"🔧","warn":"⚠️","error":"🚨","info":"ℹ️"}.get(level,"•")
                print(f"  {tag} {msg}")
        else:
            print(f"\n[Supervisor] clean — no stuck runs, no backlog, no repeat failures")
    except Exception as e:
        print(f"\n[Supervisor] ERROR - {e}")

    print("\n" + "=" * 60)
