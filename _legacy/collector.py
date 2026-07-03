import feedparser
import html
import json
import os
import re
import requests
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher

try:
    from newspaper import Article
except ImportError:
    Article = None

import trafilatura

FETCH_TIMEOUT = 10
MAX_ARTICLE_AGE_DAYS = 2

# Known limitations for content extraction:
# - NYTimes articles: require authentication/subscription (HTTP 403/401)
# - TechnologyReview.com: requires JavaScript rendering (client-side content loading)
# - Some Chosun articles: RSS-preview-only (no extractable full content)
# These articles fall back to RSS summary for summarization (see summarizer.py)


def _extract_content(url):
    # Determine minimum content threshold based on domain
    min_content_length = 200
    domain = url.split('/')[2].lower() if url else ''
    # Korean news sites often have shorter articles in RSS
    if any(d in domain for d in ['chosun.com', 'yna.co.kr', 'mk.co.kr', 'hankyung.com']):
        min_content_length = 100

    try:
        resp = requests.get(url, timeout=FETCH_TIMEOUT, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        resp.raise_for_status()
        html_content = resp.text
    except Exception as e:
        print(f"  ✗ {url} - HTTP error: {type(e).__name__}")
        return None, None

    # Check for JS-disabled messages
    if any(msg in html_content.lower() for msg in ["javascript is disabled", "enable javascript"]):
        print(f"  ✗ {url} - JavaScript required")
        return None, None

    # Try trafilatura first
    content = trafilatura.extract(html_content, include_comments=False, include_tables=False)

    # Track extraction source
    extraction_source = "trafilatura" if content and len(content) >= min_content_length else None

    # Fallback to newspaper3k if trafilatura fails or returns very little text
    if (not content or len(content) < min_content_length) and Article:
        try:
            a = Article(url)
            a.download()
            a.parse()
            if a.text and len(a.text) >= min_content_length:
                content = a.text
                extraction_source = "newspaper3k"
            elif a.text and content is None:
                # Accept newspaper3k even if short, if trafilatura failed completely
                content = a.text
                extraction_source = "newspaper3k"
        except Exception as e:
            if extraction_source is None and 'newspaper3k' not in str(type(e).__name__):
                print(f"  ✗ {url} - newspaper3k failed: {type(e).__name__}")

    if content and len(content) >= min_content_length:
        print(f"  ✓ {url} - {len(content)} chars via {extraction_source}")
    elif content and len(content) > 50:
        print(f"  ~ {url} - {len(content)} chars (short, from {extraction_source})")
    elif not content:
        print(f"  ✗ {url} - No content extracted")
    else:
        print(f"  ✗ {url} - Content too short: {len(content)} chars")

    og_image = None
    try:
        meta = trafilatura.bare_extraction(html_content, only_with_metadata=False)
        if meta:
            # bare_extraction returns a Document object (attribute access), not a dict
            img = getattr(meta, 'image', None) or (meta.get('image') if isinstance(meta, dict) else None)
            if img:
                og_image = img
    except Exception:
        pass

    # Fallback: regex-based og:image extraction (catches sites where trafilatura misses it)
    if not og_image:
        try:
            m = re.search(r'property=["\']og:image["\'][^>]*content=["\']([^"\']+)', html_content)
            if not m:
                m = re.search(r'content=["\']([^"\']+)["\'][^>]*property=["\']og:image', html_content)
            if m:
                og_image = m.group(1)
        except Exception:
            pass

    return content, og_image


def collect_news(sources_path, output_dir):
    with open(sources_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    sources = data.get('news_sources', [])

    articles = []
    date_str = datetime.now().strftime("%Y%m%d")

    for source in sources:
        try:
            feed = feedparser.parse(source['url'])
            if not feed.entries:
                print(f"  WARNING: No entries from '{source.get('name', '')}' ({source['url']})")
                continue
            now_utc = datetime.now(timezone.utc)
            for entry in feed.entries:
                # Date filter: skip articles older than MAX_ARTICLE_AGE_DAYS
                pub_parsed = getattr(entry, 'published_parsed', None)
                if pub_parsed is not None:
                    try:
                        pub_dt = datetime(*pub_parsed[:6], tzinfo=timezone.utc)
                        if (now_utc - pub_dt) > timedelta(days=MAX_ARTICLE_AGE_DAYS):
                            continue
                    except Exception:
                        pass  # Include article if date parsing fails
                image_url = None
                if hasattr(entry, 'media_content') and entry.media_content:
                    image_url = entry.media_content[0].get('url')
                elif hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
                    image_url = entry.media_thumbnail[0].get('url')
                elif hasattr(entry, 'enclosures') and entry.enclosures:
                    for enc in entry.enclosures:
                        if enc.get('type', '').startswith('image/'):
                            image_url = enc.get('href') or enc.get('url')
                            break

                raw_summary = entry.get('summary', '')
                clean_summary = html.unescape(raw_summary)
                clean_summary = re.sub(r'<[^>]+>', '', clean_summary).strip()

                articles.append({
                    'title': html.unescape(entry.get('title', '')),
                    'url': entry.get('link', ''),
                    'published_date': entry.get('published', ''),
                    'summary': clean_summary,
                    'category': source.get('category', source.get('name', 'Uncategorized')),
                    'image_url': image_url,
                    'source_name': source.get('name', ''),
                })
        except Exception as e:
            print(f"Error parsing {source.get('url', 'unknown')}: {e}")
            continue

    # Keyword-based category override: reclassify housing articles to 부동산
    HOUSING_KEYWORDS = [
        'housing market', 'real estate', 'home prices', 'home sales',
        'mortgage', 'housing prices', 'million-dollar listing',
        '부동산', '주택', '아파트', '분양', '청약', '전세', '월세', '매매가',
    ]
    for a in articles:
        title_lower = a.get('title', '').lower()
        if any(kw.lower() in title_lower for kw in HOUSING_KEYWORDS):
            a['category'] = '부동산'

    grouped = {}
    for a in articles:
        grouped.setdefault(a['category'], []).append(a)

    deduped = []
    for cat, cat_articles in grouped.items():
        seen = []
        unique = []
        for a in cat_articles:
            is_dup = False
            for s in seen:
                if SequenceMatcher(None, a['title'], s['title']).ratio() > 0.6:
                    s['source_count'] = s.get('source_count', 1) + 1
                    is_dup = True
                    break
            if not is_dup:
                a['source_count'] = 1
                seen.append(a)
                unique.append(a)
        unique.sort(key=lambda x: x.get('published_date', ''), reverse=True)
        deduped.extend(unique[:10])

    print(f"Extracting full content for {len(deduped)} articles via trafilatura...")
    for i, article in enumerate(deduped):
        url = article.get('url', '')
        if not url:
            continue
        content, og_image = _extract_content(url)
        if content:
            article['full_content'] = content
        if og_image and not article.get('image_url'):
            article['image_url'] = og_image
        if (i + 1) % 10 == 0:
            print(f"  {i + 1}/{len(deduped)} extracted...")

    with_content = sum(1 for a in deduped if a.get('full_content'))
    with_image = sum(1 for a in deduped if a.get('image_url'))
    print(f"Content extracted: {with_content}/{len(deduped)} articles, {with_image} with images")

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    output_file = os.path.join(output_dir, f"raw_{date_str}.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(deduped, f, ensure_ascii=False, indent=4)

    return output_file, deduped

if __name__ == "__main__":
    config_path = "config/news_sources.json"
    output_dir = "output"
    out_file, collected = collect_news(config_path, output_dir)
    print(f"Collected {len(collected)} articles. Saved to {out_file}")
