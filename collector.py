import feedparser
import html
import json
import os
import re
import requests
from datetime import datetime
from difflib import SequenceMatcher

try:
    from newspaper import Article
except ImportError:
    Article = None

import trafilatura

FETCH_TIMEOUT = 10


def _extract_content(url):
    try:
        resp = requests.get(url, timeout=FETCH_TIMEOUT, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        resp.raise_for_status()
        html_content = resp.text
    except Exception:
        return None, None

    # Check for JS-disabled messages
    if any(msg in html_content.lower() for msg in ["javascript is disabled", "enable javascript"]):
        return None, None

    # Try trafilatura first
    content = trafilatura.extract(html_content, include_comments=False, include_tables=False)

    # Fallback to newspaper3k if trafilatura fails or returns very little text
    if (not content or len(content) < 200) and Article:
        try:
            a = Article(url)
            a.download()
            a.parse()
            content = a.text
        except Exception:
            pass

    og_image = None
    try:
        meta = trafilatura.bare_extraction(html_content, only_with_metadata=False)
        if meta and meta.get("image"):
            og_image = meta["image"]
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
            for entry in feed.entries:
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
