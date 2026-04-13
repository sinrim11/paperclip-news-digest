/**
 * Claude API client — Ollama runtime translation.
 *
 * The docs and CLAUDE.md describe this module as an Anthropic Claude client
 * using `@anthropic-ai/sdk`. However, the board has mandated Ollama-only
 * inference (no Anthropic API key in production). This module is a thin
 * re-export of `llm.ts`, which implements the identical interface against
 * Ollama's OpenAI-compatible endpoint (http://localhost:11434/v1, gemma4:26b).
 *
 * All downstream callers that import from `@/lib/claude` get exactly the same
 * API surface as they would from `@/lib/llm` — no changes to call sites needed.
 *
 * Runtime config (via env vars, same as llm.ts):
 *   OLLAMA_BASE_URL  — default: http://localhost:11434/v1
 *   OLLAMA_MODEL     — default: gemma4:26b
 */

export {
  chat,
  chatJSON,
  isOllamaHealthy,
  type ChatMessage,
  type ChatOptions,
} from './llm';
