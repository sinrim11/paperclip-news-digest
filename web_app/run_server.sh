#!/bin/bash
# Start the Daily News Digest web server on http://localhost:8080
# Run this from any directory — it navigates to news_project/ automatically.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

export PYTHONPATH="/Users/sklee01/Library/Python/3.9/lib/python/site-packages:$PYTHONPATH"
PY39="/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9"

echo "Starting Daily News Digest browser at http://localhost:8080"
"$PY39" web_app/main.py
