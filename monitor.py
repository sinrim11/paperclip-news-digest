#!/usr/bin/env python3
"""Paperclip + Ollama unified monitor."""
import json, time, sys, urllib.request

API = "http://127.0.0.1:3100/api"
OLLAMA = "http://127.0.0.1:11434"
OLLAMA_V1 = f"{OLLAMA}/v1"
MODEL = "gemma4:26b"
COMPANY_ID = "64e10e8b-55f9-4792-ada5-d6ab564be978"

def fetch_json(url, data=None, timeout=10):
    req = urllib.request.Request(url)
    if data:
        req.add_header("Content-Type", "application/json")
        resp = urllib.request.urlopen(req, json.dumps(data).encode(), timeout=timeout)
    else:
        resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read().decode())

def check_ollama():
    # First check if model is loaded in VRAM (fast, no inference)
    try:
        ps = fetch_json(f"{OLLAMA}/api/ps", timeout=5)
        models = ps.get("models", [])
        vram = 0
        loaded = False
        for m in models:
            if MODEL in m.get("name", ""):
                loaded = True
                vram = m.get("size_vram", 0) // 1024 // 1024
    except:
        return {"status": "DOWN", "detail": "API unreachable"}

    # Then try inference
    try:
        start = time.time()
        data = fetch_json(f"{OLLAMA_V1}/chat/completions", {
            "model": MODEL,
            "messages": [{"role": "user", "content": "1+1="}],
            "max_tokens": 5
        }, timeout=15)
        elapsed = time.time() - start
        tokens = data.get("usage", {}).get("completion_tokens", 0)
        tps = tokens / elapsed if elapsed > 0 else 0
        return {"status": "OK", "tps": round(tps, 1), "latency": round(elapsed, 2), "vram": vram}
    except Exception as e:
        if loaded:
            return {"status": "BUSY", "detail": "agents using model", "vram": vram}
        return {"status": "DOWN", "detail": str(e)[:60]}

def check_agents():
    data = fetch_json(f"{API}/instance/scheduler-heartbeats")
    return [{"name": a.get("agentName", "?"),
             "heartbeat": "ON" if a.get("heartbeatEnabled") else "OFF",
             "runStatus": a.get("runStatus", "idle")} for a in data]

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

if __name__ == "__main__":
    print("=" * 60)
    print(f"  Monitor @ {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    try:
        o = check_ollama()
        s = o["status"]
        if s == "OK":
            tag = "OK" if o["tps"] > 10 else "SLOW" if o["tps"] > 3 else "CRITICAL"
            print(f"\n[Ollama] {tag} | {o['tps']} TPS | {o['latency']}s | VRAM: {o['vram']}MB")
        elif s == "BUSY":
            print(f"\n[Ollama] BUSY (agents active) | VRAM: {o['vram']}MB")
        else:
            print(f"\n[Ollama] DOWN - {o.get('detail','?')}")
    except Exception as e:
        print(f"\n[Ollama] ERROR - {e}")

    try:
        agents = check_agents()
        print(f"\n[Agents]")
        for a in agents:
            print(f"  {a['name']:10s} hb={a['heartbeat']:3s} status={a['runStatus']}")
    except Exception as e:
        print(f"\n[Agents] ERROR - {e}")

    try:
        issues = check_issues()
        print(f"\n[Issues] Total:{issues['total']} Done:{issues['done']} Active:{issues['active']} Todo:{issues['todo']} Backlog:{issues['backlog']}")
    except Exception as e:
        print(f"\n[Issues] ERROR - {e}")

    print("\n" + "=" * 60)
