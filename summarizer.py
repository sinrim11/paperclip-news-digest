import html
import json
import os
import re
import time
import urllib.request

OLLAMA_MODEL = "gemma4:latest"
OLLAMA_URL = "http://localhost:11434/api/generate"
MAX_ARTICLES = 50
TIMEOUT_SEC = 180

SYSTEM_PROMPT = (
    "당신은 뉴스 요약 전문가입니다. 반드시 한국어로만 답변하세요. "
    "영어 기사도 한국어로 번역하여 요약합니다. "
    "4-6문장, 300-800자로 작성하세요. "
    "구조: 1) 핵심 사실 2) 맥락/배경 3) 전망. "
    "숫자/고유명사 포함. 미사여구 금지."
)


def _call_ollama(text: str) -> str:
    prompt = (
        "다음 뉴스 기사를 한국어로 4-6문장 요약해줘. "
        "영어면 한국어로 번역하여 요약. 300-800자. "
        "1문장: 핵심 사실(누가/무엇/언제/어디). "
        "2-3문장: 맥락과 배경. 마지막: 전망.\n\n"
        f"{text}"
    )
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "system": SYSTEM_PROMPT,
        "prompt": prompt,
        "stream": False,
        "think": False,
        "options": {"num_predict": 1024, "temperature": 0.3},
    }).encode()
    req = urllib.request.Request(
        OLLAMA_URL, data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        data = json.loads(resp.read())
    raw = data.get("response", "")
    return html.unescape(raw.strip())


KOREAN_PATTERN = re.compile(r'[가-힣].*[가-힣].*[가-힣]')


def _needs_summary(article):
    s = article.get("summary", "")
    return not (len(s) >= 200 and KOREAN_PATTERN.search(s))


def _save(articles, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=4)


def summarize_articles(input_file):
    if not os.path.exists(input_file):
        print(f"Input file {input_file} not found.")
        return

    with open(input_file, "r", encoding="utf-8") as f:
        articles = json.load(f)

    to_process = [(i, a) for i, a in enumerate(articles[:MAX_ARTICLES]) if _needs_summary(a)]
    print(f"Need summarization: {len(to_process)}/{len(articles)} articles via Ollama ({OLLAMA_MODEL})...")

    summarized = 0
    for seq, (i, article) in enumerate(to_process):
        title = html.unescape(article.get("title", ""))
        full_content = html.unescape(article.get("full_content", ""))
        rss_summary = html.unescape(article.get("summary", ""))

        if full_content:
            input_text = f"제목: {title}\n\n본문:\n{full_content[:2000]}"
        elif len(rss_summary) >= 50:
            input_text = f"제목: {title}\n내용: {rss_summary[:1000]}"
        else:
            print(f"  [{seq+1}/{len(to_process)}] Skipped (no content): {title[:50]}")
            continue

        for attempt in range(2):
            try:
                result = html.unescape(_call_ollama(input_text))
                if len(result) >= 100:
                    article["summary"] = result
                    summarized += 1
                    _save(articles, input_file)
                    print(f"  [{seq+1}/{len(to_process)}] OK ({len(result)} chars): {title[:50]}")
                    break
                print(f"  [{seq+1}/{len(to_process)}] Too short ({len(result)}), retry {attempt+1}")
            except Exception as e:
                print(f"  [{seq+1}/{len(to_process)}] Attempt {attempt+1} failed: {e}")
                if attempt < 1:
                    time.sleep(5)
        else:
            article["summary"] = rss_summary
            _save(articles, input_file)

    print(f"완료: {summarized}/{len(to_process)}개 기사 요약됨")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        summarize_articles(sys.argv[1])
    else:
        print("Usage: python summarizer.py <input_json_file>")
