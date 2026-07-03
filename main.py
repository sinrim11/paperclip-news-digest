import os
import sys
from datetime import datetime
from collector import collect_news
from summarizer import summarize_articles
from generator import generate_digest

def main():
    # Since we are already in the news_project directory, use relative paths
    config_dir = "config"
    output_dir = "output"
    sources_path = os.path.join(config_dir, "news_sources.json")

    print("Step 1: Collecting news...")
    raw_file, _ = collect_news(sources_path, output_dir)

    print(f"Step 2: Summarizing articles from {raw_file}...")
    summarize_articles(raw_file)

    print("Step 3: Generating digest...")
    digest_file = generate_digest(raw_file, output_dir)
    
    print(f"\nSuccess! Daily digest created: {digest_file}")

if __name__ == "__main__":
    main()
