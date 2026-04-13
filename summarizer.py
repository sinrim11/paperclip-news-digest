import html
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request

# --- Configuration ---
OLLAMA_URL = "http://localhost:11434/v1/chat/completions"
OLLAMA_MODEL = "gemma4:26b"
MAX_ARTICLES = 50
TIMEOUT_SEC = 300

# --- Ollama crash recovery ---
_OLLAMA_MAX_RESTARTS = 2
_ollama_restart_count = 0


def _is_connection_error(exc: Exception) -> bool:
    if isinstance(exc, (urllib.error.URLError, ConnectionRefusedError, ConnectionResetError)):
        return True
    msg = str(exc)
    return any(s in msg for s in ("Connection refused", "Connection reset", "URLError", "RemoteDisconnected"))


def _restart_ollama() -> None:
    """Kill any stale ollama process, restart, and wait 60 s for model load."""
    global _ollama_restart_count
    if _ollama_restart_count >= _OLLAMA_MAX_RESTARTS:
        raise RuntimeError(f"Ollama restarted {_OLLAMA_MAX_RESTARTS} times already — aborting")
    _ollama_restart_count += 1
    print(
        f"  [Ollama] Crash detected — restarting "
        f"({_ollama_restart_count}/{_OLLAMA_MAX_RESTARTS})..."
    )
    # Best-effort: kill existing stale processes before re-launching
    subprocess.run(["pkill", "-f", "ollama serve"], capture_output=True)
    time.sleep(2)
    subprocess.Popen(
        ["ollama", "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print("  [Ollama] Waiting 60 s for model to reload...")
    time.sleep(60)
    print("  [Ollama] Resuming pipeline.")

# Base directory of the project
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.join(BASE_DIR, "config")


# Load terminology and category mappings
def load_json(path):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {path}: {e}")
    return {}


GLOSSARY = load_json(os.path.join(CONFIG_DIR, "glossary.json"))
# Mapping from article category name to glossary key
CATEGORY_TO_GLOSSARY = {
    "증권": "securities",
    "AI": "ai",
    "정부정책": "government_policy",
    "부동산": "real_estate",
}

# --- Prompts ---

TRANSLATION_SYSTEM_PROMPT = (
    "당신은 국제 뉴스를 한국어로 자연스럽게 번역하는 전문가입니다.\n\n"
    "[지시사항]\n"
    "1. 주어진 기사를 읽고 핵심 내용을 정확하게 한국어로 번역하세요.\n"
    "2. 번역은 자연스러운 한국어 문장으로, 합쇼체(-습니다, -입니다, -했습니다)를 사용하세요.\n"
    "3. 직역을 피하고 문맥을 고려하여 의역으로 표현하세요.\n"
    "4. 기자 이름, 특파원, 발신지(예: (서울=연합뉴스)), 저작권 문구는 절대 포함하지 마세요.\n"
    "5. 제시된 용어를 우선적으로 사용하고, 전문적인 표현을 유지하세요.\n"
    "6. 마크다운(##, -, *, **)이나 번호(1., 2., 3.) 기호를 사용하지 마세요.\n"
    "7. 5~7문장의 순수한 한국어로만 작성하세요. (반드시 300자 이상 작성)\n\n"
    "[번역 예시 - 금융/경제]\n"
    "입력: The Federal Reserve raised interest rates by 25 basis points today to combat inflation.\n"
    "출력: 연방준비제도가 인플레이션에 대응하기 위해 오늘 이자율을 25베이시스포인트 인상했습니다.\n"
    "..."
)

REFINEMENT_SYSTEM_PROMPT = (
    "당신은 뉴스를 요약하는 전문가입니다. 다음 텍스트를 읽고, 독자가 한눈[...]"
)


REFINEMENT_SYSTEM_PROMPT = (
    "당신은 뉴스 요약을 자연스럽게 다듬는 전문 에디터입니다.\n\n"
    "[지시사항]\n"
    "1. 입력된 요약문을 정독하고 다음 3단계 구조로 작성하세요 (전체 300~600자 목표):\n"
    "   - 핵심 요약: 가장 중요한 사실 1문장 (기사의 핵심을 한 문장으로)\n"
    "   - 주요 내용: 세부 내용 2~3문장 (배경, 경과, 수치, 영향 등)\n"
    "   - 엔티티: 관련 기관/인물/수치를 마지막 문장에 자연스럽게 언급\n"
    "2. 각 문장은 합쇼체(-습니다, -입니다, -했습니다)로 끝내세요.\n"
    "3. 기자명, 발신지(예: (서울=연합뉴스)), 저작권 표기 등은 절대 포함하지 마세요.\n"
    "4. 마크다운(##, -, *, **) 또는 이모지를 사용하지 마세요.\n"
    "5. 요약을 더욱 자연스럽고 읽기 좋게 표현하세요.\n"
    "6. 불필요한 중복을 제거하되, 충분한 정보(300자 이상)를 전달하세요.\n"
    "7. 형식: 번호 없이 4~5개 문장을 연속적으로 작성하세요.\n\n"
    "[개선 예시]\n"
    "입력: 미 연준이 금리를 인상했습니다. 이는 인플레이션 대응 조치입니다. 시장은 충격을 받았습니다. "
    "인상폭은 0.25%포인트입니다.\n"
    "출력: 미국 연방준비제도(Fed)가 인플레이션 억제를 위해 기준금리를 0.25%포인트 인상했습니다. "
    "이는 올해 다섯 번째 인상 조치로, 연준의 강력한 통화 긴축 의지를 재확인한 것입니다. "
    "금리 인상 발표 직후 뉴욕 증시가 하락세를 보이며 투자 심리가 악화되었습니다. "
    "경제 전문가들은 추가 금리 인상이 기업 대출 비용 상승과 소비 위축으로 이어져 경기 침체를 유발할 수 있다고 경고합니다. "
    "연준은 물가 상승률이 목표치인 2%에 근접할 때까지 긴축 기조를 유지하겠다고 밝혔습니다.\n\n"
    "[개선 예시 2]\n"
    "입력: 삼성전자가 신제품을 출시했다. 가격은 1,200만 원이다. 시장의 반응이 긍정적이다.\n"
    "출력: 삼성전자가 1,200만 원대의 신형 프리미엄 제품을 공식 출시하며 시장의 뜨거운 관심을 받고 있습니다. "
    "해당 제품은 업계 최초로 적용된 혁신 기술을 탑재하여 성능과 디자인 측면에서 높은 평가를 받았습니다. "
    "출시 첫 주 예약 판매량이 전작 대비 40% 증가했으며, 글로벌 시장에서도 긍정적인 반응이 이어지고 있습니다. "
    "시장 분석가들은 올해 연간 판매량이 전년 동기 대비 30% 증가할 것으로 예측하고 있습니다. "
    "삼성전자 측은 이번 신제품이 프리미엄 시장에서의 입지를 강화하는 데 핵심적인 역할을 할 것이라고 강조했습니다."
)

# --- Core Functions ---


def _call_ollama(prompt_system, prompt_user, temperature=0.3, top_p=0.9) -> str:
    payload = json.dumps(
        {
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": prompt_system},
                {"role": "user", "content": prompt_user},
            ],
            "max_tokens": 1024,
            "temperature": temperature,
            "top_p": top_p,
            "stream": False,
        }
    ).encode()
    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        data = json.loads(resp.read())
    raw = data["choices"][0]["message"]["content"]
    return html.unescape(raw.strip())


def quality_check(text: str, min_length=300, max_length=800) -> bool:
    """
    Comprehensive quality check for Korean text summaries.
    Validates: length, Korean character ratio, sentence completion, natural flow.
    """
    if not text or len(text) < min_length or len(text) > max_length:
        return False

    # Check Korean character ratio (should be mostly Korean)
    korean_chars = len(re.findall(r"[가-힣]", text))
    total_chars = len(text)
    korean_ratio = korean_chars / total_chars if total_chars > 0 else 0

    # Should be mostly Korean (70%+), with some English allowed for proper nouns/terms
    if korean_ratio < 0.65:
        return False

    # Check for proper sentence endings (must end with proper punctuation)
    proper_endings = (
        "습니다.",
        "입니다.",
        "있습니다.",
        "했습니다.",
        "였습니다.",
        "있으며",
        "보였습니다.",
        "이루었습니다.",
        "됩니다.",
        "맺혔습니다.",
    )
    ends_properly = text.strip().endswith((".", "!", "?", "습니다", "입니다")) or any(
        text.strip().endswith(ending) for ending in proper_endings
    )

    if not ends_properly:
        return False

    # Check for unwanted patterns (journalist names, bylines, copyright)
    unwanted_patterns = [
        r"기자\s*=",  # Reporter byline
        r"=\s*기자",  # Reporter byline (reversed)
        r"\(서울=|도쿄=|뉴욕=|홍콩=|싱가포르=|런던=",  # Wire service byline prefixes
        r"저작권|Copyright|©",  # Copyright notice
        r"(?m)^\d+\.\s",  # Numbered lists at start of any line (should be narrative)
    ]

    for pattern in unwanted_patterns:
        try:
            if re.search(pattern, text):
                return False
        except re.error:
            # Silently skip malformed patterns
            continue

    # Check for minimum word count (at least 3-4 sentences worth of content)
    word_count = len(text.split())
    if word_count < 20:  # Too short even for a summary
        return False

    return True


def _needs_summary(article):
    s = article.get("summary", "")
    if "JavaScript is disabled" in s:
        return True
    # Check if it's already a good Korean summary
    korean_chars = len(re.findall(r"[가-힣]", s))
    return not (len(s) >= 300 and (korean_chars / len(s) > 0.7))


def _save(articles, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, indent=4)


def summarize_articles(input_file, force=False):
    if not os.path.exists(input_file):
        print(f"Input file {input_file} not found.")
        return

    with open(input_file, "r", encoding="utf-8") as f:
        articles = json.load(f)

    if force:
        print("Force mode enabled: Processing all articles...")
        to_process = [(i, a) for i, a in enumerate(articles[:MAX_ARTICLES])]
    else:
        to_process = [
            (i, a) for i, a in enumerate(articles[:MAX_ARTICLES]) if _needs_summary(a)
        ]

    print(
        f"Need summarization: {len(to_process)}/{len(articles)} articles via Ollama ({OLLAMA_MODEL})..."
    )

    summarized_count = 0
    for seq, (i, article) in enumerate(to_process):
        title = html.unescape(article.get("title", ""))
        full_content = html.unescape(article.get("full_content", ""))
        rss_summary = html.unescape(article.get("summary", ""))
        category_name = article.get("category", "")

        # Prepare input text
        if full_content:
            input_text = f"Title: {title}\n\nContent:\n{full_content[:1500]}"
        elif len(rss_summary) >= 50:
            input_text = f"Title: {title}\n\nContent:\n{rss_summary[:1200]}"
        else:
            print(f"  [{seq + 1}/{len(to_process)}] Skipped (no content): {title[:50]}")
            continue

        # Prepare glossary context for better prompt integration
        glossary_context = ""
        glossary_key = CATEGORY_TO_GLOSSARY.get(category_name)
        if glossary_key and glossary_key in GLOSSARY:
            terms = GLOSSARY[glossary_key]
            # Format glossary terms naturally in prompt
            glossary_context = "\n[이 카테고리의 주요 용어]\n" + ", ".join(
                [f"{k} = {v}" for k, v in list(terms.items())[:10]]
            )

        success = False
        quality_attempt = 0
        max_quality_attempts = 2

        while not success and quality_attempt < max_quality_attempts:
            quality_attempt += 1
            try:
                # --- Step 1: Translation with improved parameters ---
                translation_user_prompt = (
                    f"카테고리: {category_name}{glossary_context}\n\n"
                    f"다음 기사를 자연스럽고 정확하게 한국어로 요약하세요:\n\n{input_text}"
                )

                translated_text = _call_ollama(
                    TRANSLATION_SYSTEM_PROMPT,
                    translation_user_prompt,
                    temperature=0.35,
                    top_p=0.85,
                )

                if not quality_check(translated_text, min_length=150, max_length=800):
                    if quality_attempt == 1:
                        print(
                            f"  [{seq + 1}/{len(to_process)}] Translation quality check failed, retrying..."
                        )
                    continue

                # --- Step 2: Natural refinement ---
                refinement_user_prompt = (
                    f"다음 요약문을 더욱 자연스럽고 읽기 좋게 다듬되, "
                    f"핵심 내용은 변하지 않도록 하세요:\n\n{translated_text}"
                )

                refined_text = _call_ollama(
                    REFINEMENT_SYSTEM_PROMPT,
                    refinement_user_prompt,
                    temperature=0.5,
                    top_p=0.9,
                )

                if quality_check(refined_text, min_length=300, max_length=800):
                    article["summary"] = refined_text
                    success = True
                elif quality_check(translated_text, min_length=150, max_length=800):
                    article["summary"] = translated_text
                    success = True
                else:
                    if quality_attempt == 1:
                        print(
                            f"  [{seq + 1}/{len(to_process)}] Quality check failed for both steps, retrying..."
                        )

                if success:
                    summarized_count += 1
                    _save(articles, input_file)
                    print(f"  [{seq + 1}/{len(to_process)}] ✓ {title[:50]}")

            except Exception as e:
                if _is_connection_error(e):
                    print(
                        f"  [{seq + 1}/{len(to_process)}] Ollama connection error: {str(e)[:80]}"
                    )
                    try:
                        _restart_ollama()
                        # Reset quality attempts so the article is retried from scratch
                        quality_attempt = 0
                    except RuntimeError as restart_err:
                        print(f"  [{seq + 1}/{len(to_process)}] {restart_err}")
                        break
                else:
                    print(
                        f"  [{seq + 1}/{len(to_process)}] Attempt {quality_attempt} error: {str(e)[:60]}"
                    )
                    if quality_attempt < max_quality_attempts:
                        time.sleep(3)

        if not success:
            print(f"  [{seq + 1}/{len(to_process)}] FAILED: {title[:50]}")
            article["summary"] = rss_summary  # Fallback to original RSS summary

    print(f"완료: {summarized_count}/{len(to_process)}개 기사 요약됨")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        path = sys.argv[1]
        force_mode = "--force" in sys.argv
        # If --force is present, we need to find the actual file path in args
        if force_mode:
            # Find the first argument that is not --force and looks like a file
            # Skip sys.argv[0] (script name) by using sys.argv[1:]
            path_args = [
                a for a in sys.argv[1:] if a != "--force" and not a.startswith("-")
            ]
            if path_args:
                summarize_articles(path_args[0], force=True)
            else:
                print("Usage: python summarizer.py <input_json_file> [--force]")
        else:
            summarize_articles(path, force=False)
    else:
        print("Usage: python summarizer.py <input_json_file> [--force]")
