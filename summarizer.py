import html
import json
import os
import re
import time
import urllib.request

# --- Configuration ---
MLX_MODEL = "mlx-community/gemma-2-2b-it"
MLX_URL = "http://localhost:8080/v1/chat/completions"
OLLAMA_FALLBACK_URL = "http://localhost:11434/v1/chat/completions"
OLLAMA_FALLBACK_MODEL = "gemma4:26b"
MAX_ARTICLES = 50
TIMEOUT_SEC = 300

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
    "증권": "securities",
    "AI": "ai",
    "정부정책": "government_policy",
    "부동산": "real_estate"
}

# --- Prompts ---

TRANSLATION_SYSTEM_PROMPT = (
    "당신은 국제 뉴스를 한국어로 자연스럽게 번역하는 전문가입니다.\n\n"
    "[지시사항]\n"
    "1. 주어진 기사를 읽고 핵심 내용을 정확하게 한국어로 요약하세요.\n"
    "2. 요약은 자연스러운 한국어 문장으로, 합쇼체(-습니다, -입니다, -했습니다)를 사용하세요.\n"
    "3. 직역을 피하고 문맥을 고려하여 의역으로 표현하세요.\n"
    "4. 기자 이름, 특파원, 발신지(예: (서울=연합뉴스)), 저작권 문구는 절대 포함하지 마세요.\n"
    "5. 제시된 용어를 우선적으로 사용하고, 전문적인 표현을 유지하세요.\n"
    "6. 마크다운(##, -, *, **)이나 번호(1., 2., 3.) 기호를 사용하지 마세요.\n"
    "7. 3~4문장의 순수한 한국어로만 작성하세요.\n\n"
    "[번역 예시 - 금융/경제]\n"
    "입력: The Federal Reserve raised interest rates by 0.25 percentage points to combat persistent inflation, marking the fifth increase this year. Markets reacted cautiously, with analysts debating whether further hikes would slow economic growth.\n"
    "출력: 미국 연방준비제도는 지속적인 인플레이션에 대응하기 위해 기준금리를 0.25%포인트 인상했습니다. 이는 올해 다섯 번째 인상으로, 추가 금리 인상이 경제 성장을 둔화시킬 수 있다는 우려가 제기되고 있습니다.\n\n"
    "[번역 예시 - 정치/외교]\n"
    "입력: Pakistan's military leadership conducted extensive diplomatic negotiations for over two weeks to broker a ceasefire between Iran and Israel, concerned about the devastating economic and security impacts of regional escalation.\n"
    "출력: 파키스탄의 군 지도부는 지역 분쟁 확산으로 인한 경제와 안보상 치명적 피해를 우려하여 이란과 이스라엘 간 휴전을 중재하기 위해 2주 이상의 집중 외교담판을 벌였습니다.\n\n"
    "[번역 예시 - 과학/기술]\n"
    "입력: Artificial intelligence models require massive computational resources during training, with some large language models consuming millions of dollars in computing infrastructure before deployment.\n"
    "출력: 인공지능 모델, 특히 대규모 언어 모델은 배포 전 학습 과정에서 막대한 컴퓨팅 인프라 비용을 소모합니다.\n\n"
    "[번역 예시 - 회피해야 할 경우]\n"
    "입력: (Seoul=Yonhapnews) Reporter Kim Dongho = Samsung Electronics shares surged yesterday.\n"
    "출력: 삼성전자 주가가 어제 장중 급등세를 보였습니다."
)

REFINEMENT_SYSTEM_PROMPT = (
    "당신은 뉴스 요약을 자연스럽게 다듬는 전문 에디터입니다.\n\n"
    "[지시사항]\n"
    "1. 입력된 요약문을 정독하고 가장 중요한 3가지 핵심 사실을 추출하세요.\n"
    "2. 각 사실은 명확하고 완전한 문장으로, 합쇼체(-습니다, -입니다, -했습니다)로 끝내세요.\n"
    "3. 기자명, 발신지(예: (서울=연합뉴스)), 저작권 표기 등은 절대 포함하지 마세요.\n"
    "4. 마크다운(##, -, *, **) 또는 이모지를 사용하지 마세요.\n"
    "5. 요약을 더욱 자연스럽고 읽기 좋게 표현하세요.\n"
    "6. 불필요한 중복을 제거하되, 의미는 충분히 전달하세요.\n"
    "7. 형식: 번호 없이 3개 문장을 연속적으로 작성하세요.\n\n"
    "[개선 예시]\n"
    "입력: 미 연준이 금리를 인상했습니다. 이는 인플레이션 대응 조치입니다. 시장은 충격을 받았습니다. "
    "인상폭은 0.25%포인트입니다.\n"
    "출력: 미국 연방준비제도가 인플레이션 억제를 위해 기준금리를 0.25%포인트 인상했습니다. "
    "이는 올해 다섯 번째 인상 조치입니다. 금리 인상 발표 직후 주식시장이 하락세를 보였습니다.\n\n"
    "[개선 예시 2]\n"
    "입력: 삼성전자가 신제품을 출시했다. 가격은 1,200만 원이다. 시장의 반응이 긍정적이다.\n"
    "출력: 삼성전자가 1,200만 원대의 신 프리미엄 제품을 출시했습니다. "
    "해당 제품은 업계 최초의 혁신 기술을 탑재했다는 점에서 주목을 받고 있습니다. "
    "시장 분석가들은 올해 판매량이 전년 동기 대비 30% 증가할 것으로 예측하고 있습니다."
)

# --- Core Functions ---

def _call_mlx(prompt_system, prompt_user, temperature=0.3, top_p=0.9) -> str:
    def _call_endpoint(url, model):
        payload = json.dumps({
            "model": model,
            "messages": [
                {"role": "system", "content": prompt_system},
                {"role": "user", "content": prompt_user},
            ],
            "max_tokens": 1024,
            "temperature": temperature,
            "top_p": top_p,
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

def quality_check(text: str, min_length=50, max_length=600) -> bool:
    """
    Comprehensive quality check for Korean text summaries.
    Validates: length, Korean character ratio, sentence completion, natural flow.
    """
    if not text or len(text) < min_length or len(text) > max_length:
        return False

    # Check Korean character ratio (should be mostly Korean)
    korean_chars = len(re.findall(r'[가-힣]', text))
    total_chars = len(text)
    korean_ratio = korean_chars / total_chars if total_chars > 0 else 0

    # Should be mostly Korean (70%+), with some English allowed for proper nouns/terms
    if korean_ratio < 0.65:
        return False

    # Check for proper sentence endings (must end with proper punctuation)
    proper_endings = ('습니다.', '입니다.', '있습니다.', '했습니다.', '였습니다.',
                      '있으며', '보였습니다.', '이루었습니다.', '됩니다.', '맺혔습니다.')
    ends_properly = text.strip().endswith(('.', '!', '?', '습니다', '입니다')) or \
                   any(text.strip().endswith(ending) for ending in proper_endings)

    if not ends_properly:
        return False

    # Check for unwanted patterns (journalist names, bylines, copyright)
    unwanted_patterns = [
        r'기자\s*=',  # Reporter byline
        r'=\s*기자',  # Reporter byline (reversed)
        r'\(서울=|도쿄=|뉴욕=|홍콩=|싱가포르=|런던=',  # Wire service byline prefixes
        r'저작권|Copyright|©',  # Copyright notice
        r'^1\.\s|^2\.\s|^3\.\s',  # Numbered lists at start (should be narrative)
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

        # Prepare glossary context for better prompt integration
        glossary_context = ""
        glossary_key = CATEGORY_TO_GLOSSARY.get(category_name)
        if glossary_key and glossary_key in GLOSSARY:
            terms = GLOSSARY[glossary_key]
            # Format glossary terms naturally in prompt
            glossary_context = (
                "\n[이 카테고리의 주요 용어]\n"
                + ", ".join([f"{k} = {v}" for k, v in list(terms.items())[:10]])
            )

        success = False
        for attempt in range(2):
            try:
                # --- Step 1: Translation with improved parameters ---
                # Integrate glossary naturally into the prompt
                translation_user_prompt = (
                    f"카테고리: {category_name}{glossary_context}\n\n"
                    f"다음 기사를 자연스럽고 정확하게 한국어로 요약하세요:\n\n{input_text}"
                )

                # Lower temperature for consistency and accuracy in translation
                translated_text = _call_mlx(
                    TRANSLATION_SYSTEM_PROMPT,
                    translation_user_prompt,
                    temperature=0.35,
                    top_p=0.85
                )

                if not quality_check(translated_text, min_length=60, max_length=400):
                    if attempt == 0:
                        print(f"  [{seq+1}/{len(to_process)}] Translation quality check failed, retrying with adjusted params...")
                    continue

                # --- Step 2: Natural refinement (not strict restructuring) ---
                # Focus on smoothness and readability rather than numbering
                refinement_user_prompt = (
                    f"다음 요약문을 더욱 자연스럽고 읽기 좋게 다듬되, "
                    f"핵심 내용은 변하지 않도록 하세요:\n\n{translated_text}"
                )

                # Moderate temperature for better expression while maintaining meaning
                refined_text = _call_mlx(
                    REFINEMENT_SYSTEM_PROMPT,
                    refinement_user_prompt,
                    temperature=0.5,
                    top_p=0.9
                )

                # Accept refined text if it passes quality check
                if quality_check(refined_text, min_length=60, max_length=400):
                    article["summary"] = refined_text
                    success = True
                elif quality_check(translated_text, min_length=60, max_length=400):
                    # Fallback to translated text if refinement fails
                    article["summary"] = translated_text
                    success = True
                else:
                    if attempt == 0:
                        print(f"  [{seq+1}/{len(to_process)}] Quality check failed for both steps, retrying...")

                if success:
                    summarized_count += 1
                    _save(articles, input_file)
                    print(f"  [{seq+1}/{len(to_process)}] ✓ {title[:50]}")
                    break

            except Exception as e:
                print(f"  [{seq+1}/{len(to_process)}] Attempt {attempt+1} error: {str(e)[:60]}")
                if attempt < 1:
                    time.sleep(3)

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
             # Skip sys.argv[0] (script name) by using sys.argv[1:]
             path_args = [a for a in sys.argv[1:] if a != "--force" and not a.startswith("-")]
             if path_args:
                 summarize_articles(path_args[0], force=True)
             else:
                 print("Usage: python summarizer.py <input_json_file> [--force]")
        else:
            summarize_articles(path, force=False)
    else:
        print("Usage: python summarizer.py <input_json_file> [--force]")
