#!/usr/bin/env bash
# Validates that .env.local points to LM Studio (localhost:1234) and not Ollama.
# Exit 0 = OK, Exit 1 = forbidden config detected.
set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[check_env_config] WARN: .env.local not found, skipping check."
  exit 0
fi

CONTENT="$(cat "$ENV_FILE")"

# Must reference localhost:1234
if ! echo "$CONTENT" | grep -q "localhost:1234"; then
  echo "[check_env_config] FAIL: .env.local does not reference localhost:1234 (LM Studio)."
  exit 1
fi

# Must NOT reference Ollama
FORBIDDEN=("ollama" "localhost:11434" "gemma4:26b")
for term in "${FORBIDDEN[@]}"; do
  if echo "$CONTENT" | grep -qi "$term"; then
    echo "[check_env_config] FAIL: .env.local contains forbidden string: '$term'"
    exit 1
  fi
done

echo "[check_env_config] OK — LLM_BASE_URL=localhost:1234 confirmed, no Ollama config detected."
exit 0
