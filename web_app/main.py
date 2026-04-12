"""
FastAPI web server for Daily News Digest Browser.
Reads the latest raw_YYYYMMDD.json from ../output/ and renders it.
Run from: news_project/ directory with `python3 web_app/main.py`
"""

import json
import os
import glob
from datetime import datetime

import uvicorn
from fastapi import FastAPI
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.requests import Request
from fastapi.responses import JSONResponse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "..", "output")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="Daily News Digest Browser")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def load_latest_articles():
    """Load the most recent raw_YYYYMMDD.json from the output directory."""
    pattern = os.path.join(OUTPUT_DIR, "raw_*.json")
    files = sorted(glob.glob(pattern))
    if not files:
        return [], "데이터 없음"

    latest_file = files[-1]
    with open(latest_file, "r", encoding="utf-8") as f:
        articles = json.load(f)

    basename = os.path.basename(latest_file)
    date_str = basename.replace("raw_", "").replace(".json", "")
    try:
        display_date = datetime.strptime(date_str, "%Y%m%d").strftime("%Y년 %m월 %d일")
    except ValueError:
        display_date = date_str

    return articles, display_date


def group_by_category(articles):
    """Group articles by category field."""
    grouped = {}
    for article in articles:
        cat = article.get("category", "기타")
        if cat not in grouped:
            grouped[cat] = []
        grouped[cat].append(article)
    return grouped


@app.get("/")
async def index(request: Request):
    articles, display_date = load_latest_articles()
    articles_by_category = group_by_category(articles)
    last_updated = datetime.now().strftime("%Y-%m-%d %H:%M")
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "articles_by_category": articles_by_category,
            "last_updated": last_updated,
            "display_date": display_date,
            "total_articles": len(articles),
        },
    )


@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})


if __name__ == "__main__":
    print("Starting Daily News Digest server at http://localhost:8080")
    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="info")
