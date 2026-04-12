# 일일 뉴스 다이제스트 시스템

Korean news aggregation and summarization pipeline with web browser UI.

Collects RSS feeds from 25+ Korean and international sources, extracts full article content via trafilatura, summarizes in Korean using a local Ollama LLM, and serves a browsable digest via FastAPI.

## Requirements

- Python 3.9+
- [Ollama](https://ollama.com) with a Gemma 4 model (e.g. `gemma4:latest`)

## Setup

```bash
pip install -r requirements.txt

# Verify Ollama is running
ollama list
```

## Usage

### Collect and summarize news

```bash
python main.py
```

This runs the full pipeline:
1. **Collect** — fetches RSS feeds, deduplicates, extracts full content
2. **Summarize** — generates Korean summaries via Ollama
3. **Generate** — produces a markdown digest

Output files are written to `output/`.

### Browse in web UI

```bash
python web_app/main.py
# Open http://localhost:8080
```

## Project Structure

```
├── main.py              # Pipeline entry point
├── collector.py         # RSS feed collector + content extraction
├── summarizer.py        # Ollama-based Korean summarizer
├── generator.py         # Markdown digest generator
├── requirements.txt
├── config/
│   ├── news_sources.json    # RSS feed URLs by category
│   ├── categories.json      # Category definitions
│   └── digest_template.md
├── output/                  # Generated data (gitignored)
└── web_app/
    ├── main.py              # FastAPI server (port 8080)
    └── templates/
        └── index.html       # News digest browser
```

## News Sources

- **국내 정치/경제/사회**: 연합뉴스, 조선일보, 중앙일보, 동아일보, 한겨레, 경향신문, KBS, MBC, SBS, JTBC, 한국경제, 매일경제
- **International**: BBC, Reuters, The Guardian, NYT, Al Jazeera, CNBC, TechCrunch, MIT Tech Review, The Verge
