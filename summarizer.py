import html
import json
import os
import re
import time
import urllib.request

# --- Configuration ---
MLX_MODEL = "mlx-community/gemma-4-26b-a4b-it-8bit"
MLX_URL = "http://localhost:8080/v1/chat/completions"
OLLAMA_FALLBACK_URL = "http://localhost:11434/v1/chat/completions"
OLLAMA_FALLBACK_MODEL = "gemma4:26b"
MAX_ARTICLES = 50
TIMEOUT_SEC = 180

# Base directory of the project
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.join(BASE_DIR, "config")

# Load terminology and category mappings
def load_json(path):
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {path}: {e}")
    return {}

GLOSSARY = load_json(os.path.join(CONFIG_DIR, "glossary.json"))
# Mapping from article category name to glossary key
CATEGORY_TO_GLOSSARY = {
    "증권 관련 뉴스": "securities",
    "AI 관련 뉴스": "ai",
    "정부 정책 뉴스": "government_policy",
    "부동산 뉴스": "real_estate"
}

# --- Prompts ---

TRANSLATION_SYSTEM_PROMPT = (
    "당신은 전문 뉴스 번역가입니다. 다음 영어 기사를 한국어로 번역하세요. "
    "문맥을 고려하여 자연스럽게 번역하되, 원문의 핵심 사실을 누락하지 마세요. "
    "제공된 용어집(Glossary)이 있다면 반드시 그 용어를 사용하여 번역하세요. "
    "마크다운 기호(##, -, *, **)를 사용하지 마세요. "
    "결과는 순수한 한국어 텍스트로만 출력하세요. "
    "\n\n[예시]\n"
    "입력: The Fed raised interest rates to fight inflation.\n"
    "출력: 연준은 인플레이션에 대응하기 위해 금리를 인상했습니다.\n"
    "입력: Apple's stock price surged after the launch of the new iPhone.\n"
    "출력: 새로운 아이폰 출시 이후 애플의 주가가 급등했습니다."
)

REFINEMENT_SYSTEM_PROMPT = (
    "당신은 전문 뉴스 에디터입니다. 다음 번역된 한국어 요약문을 읽고, "
    "더 자연스럽고 세련된 한국어 문장으로 윤문(polishing)하세요. "
    "문장은 간결하고 명확해야 하며, 신문 기사 스타일의 문어체를 사용하세요. "
    "불필요한 미사여구는 제거하고 핵심 정보를 강조하세요. "
    "마크다운 기호(##, -, *, **)를 절대로 사용하지 마세요. "
    "결과는 순수한 한국어 텍스트로만 출력하세요. "
    "\n\n[예시]\n"
    "입력: 이 회사는 매우 좋은 실적을 보여주었습니다. 그것은 놀랍습니다.\n"
    "출력: 해당 기업은 예상치를 상회하는 놀라운 실적을 발표했습니다.\n"
    "입력: 금리가 오를 것이라고 사람들은 말합니다. 그래서 경제가 어려워집니다.\n"
    "출력: 금리 인상 전망에 따라 경기 침체에 대한 우려가 커지고 있습니다."
)

# --- Core Functions ---

def _call_mlx(prompt_system, prompt_user, temperature=0.3) -> str:
    def _call_endpoint(url, model):
        payload = json.dumps({
            "model": model,
            "messages": [
                {"role": "system", "content": prompt_system},
                {"role": "user", "content": prompt_user},
            ],
            "max_tokens": 1024,
            "temperature": temperature,
            "stream": False,
        }).encode()
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
            data = json.loads(resp.read())
        raw = data["choices"][0]["message"]["content"]
        return html.unescape(raw.strip())

    try:
        return _call_endpoint(MLX_URL, MLX_MODEL)
    except Exception as e:
        if "Connection refused" in str(e) or "61" in str(e):
            return _call_endpoint(OLLAMA_FALLBACK_URL, OLLAMA_FALLBACK_MODEL)
        raise

def quality_check(text: str) -> bool:
    """Checks if the text meets basic quality criteria."""
    if not text or len(text) < 50:
        return False
    
    # Check Korean character ratio
    korean_chars = len(re.findall(r'[가-힣]', text))
    total_chars = len(text)
    korean_ratio = korean_chars / total_chars
    
    # Check for sentence completion (ends with . ! or ?)
    ends_properly = text.strip().endswith(('.', '!', '?'))
    
    return korean_ratio > 0.7 and ends_properly

def _needs_summary(article):
    s = article.get("summary", "")
    if "JavaScript is disabled" in s:
        return True
    # Check if it's already a good Korean summary
    korean_chars = len(re.findall(r'[가-힣]', s))
    return not (len(s) >= 150 and (korean_chars / len(s) > 0.7))

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
        to_process = [(i, a) for i, a in enumerate(articles[:MAX_ARTICLES]) if _needs_summary(a)]
        
    print(f"Need summarization: {len(to_process)}/{len(articles)} articles via MLX ({MLX_MODEL})...")

    summarized_count = 0
    for seq, (i, article) in enumerate(to_process):
        title = html.unescape(article.get("title", ""))
        full_content = html.unescape(article.get("full_content", ""))
        rss_summary = html.unescape(article.get("summary", ""))
        category_name = article.get("category", "")

        # Prepare input text
        if full_content:
            input_text = f"Title: {title}\n\nContent:\n{full_content[:2500]}"
        elif len(rss_summary) >= 50:
            input_text = f"Title: {title}\n\nContent:\n{rss_summary[:1200]}"
        else:
            print(f"  [{seq+1}/{len(to_process)}] Skipped (no content): {title[:50]}")
            continue

        # Prepare glossary context
        glossary_context = ""
        glossary_key = CATEGORY_TO_GLOSSARY.get(category_name)
        if glossary_key and glossary_key in GLOSSARY:
            terms = GLOSSARY[glossary_key]
            glossary_context = "\n[Glossary]\n" + "\n".join([f"{k} -> {v}" for k, v in terms.items()])

        success = False
        for attempt in range(2):
            try:
                # --- Step 1: Translation ---
                translation_user_prompt = f"{glossary_context}\n\nTranslate the following article to Korean:\n\n{input_text}"
                translated_text = _call_mlx(TRANSLATION_SYSTEM_PROMPT, translation_user_prompt, temperature=0.2)
                
                if not quality_check(translated_text):
                    print(f"  [{seq+1}/{len(to_process)}] Translation quality low, retrying...")
                    continue

                # --- Step 2: Refinement ---
                refinement_user_prompt = f"Refine this Korean translation into a natural news summary:\n\n{translated_text}"
                refined_text = _call_mlx(REFINEMENT_SYSTEM_PROMPT, refinement_user_prompt, temperature=0.7)

                if quality_check(refined_text):
                    article["summary"] = refined_text
                    success = True
                elif quality_check(translated_text):
                    # Fallback to translated text if refinement fails
                    article["summary"] = translated_text
                    success = True
                else:
                    print(f"  [{seq+1}/{len(to_process)}] Both steps failed quality check, retrying...")
                
                if success:
                    summarized_count += 1
                    _save(articles, input_file)
                    print(f"  [{seq+1}/{len(to_process)}] OK: {title[:50]}")
                    break

            except Exception as e:
                print(f"  [{seq+1}/{len(to_process)}] Attempt {attempt+1} failed: {e}")
                if attempt < 1:
                    time.sleep(5)

        if not success:
            print(f"  [{seq+1}/{len(to_process)}] FAILED: {title[:50]}")
            article["summary"] = rss_summary # Fallback to original RSS summary

    print(f"완료: {summarized_count}/{len(to_process)}개 기사 요약됨")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        path = sys.argv[1]
        force_mode = "--force" in sys.argv
        # If --force is present, we need to find the actual file path in args
        if force_mode:
             # Find the first argument that is not --force and looks like a file
             path_args = [a for a in sys.argv if a != "--force" and not a.startswith("-")]
             if path_args:
                 summarize_articles(path_args[0], force=True)
             else:
                 print("Usage: python summarizer.py <input_json_file> [--force]")
        else:
            summarize_articles(path, force=False)
    else:
        print("Usage: python summarizer.py <input_json_file> [--force]")
