/**
 * Claude API client — @anthropic-ai/sdk implementation.
 *
 * Provides chat() and chatJSON<T>() for all LLM calls, plus optional
 * web_search_20250305 built-in tool for the news-collector pipeline.
 *
 * Config (env vars):
 *   ANTHROPIC_API_KEY — required in production
 *   ANTHROPIC_MODEL   — default: claude-sonnet-4-20250514
 *
 * Retries: 2 attempts on transient errors (total 3 tries)
 * Timeout: 60 s per call (per-category budget)
 * Temperature: 0.3 (fact-based accuracy)
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';
const TEMPERATURE = 0.3;
const MAX_TOKENS = 8192;
const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3; // 1 original + 2 retries

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: TIMEOUT_MS,
});

// ── Types (compatible with llm.ts surface for drop-in use) ─────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  /** Pass true to enable Claude's built-in web_search_20250305 tool. */
  useWebSearch?: boolean;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function logUsage(usage: Anthropic.Usage, model: string): void {
  // claude-sonnet-4 pricing: $3/M input · $15/M output
  const costUsd = (usage.input_tokens * 3 + usage.output_tokens * 15) / 1_000_000;
  console.log(
    `[claude] model=${model} in=${usage.input_tokens} out=${usage.output_tokens} cost=$${costUsd.toFixed(4)}`,
  );
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        const delayMs = attempt * 1_000; // 1 s, then 2 s
        console.warn(`[claude] retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delayMs}ms:`, err);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Plain text completion.
 *
 * `system` role messages are extracted and forwarded as the top-level
 * `system` parameter (Anthropic API requirement).
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const {
    temperature = TEMPERATURE,
    maxTokens = MAX_TOKENS,
    model = MODEL,
    useWebSearch = false,
  } = options;

  const systemText = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');

  const conversationMessages: Anthropic.MessageParam[] = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  return withRetry(async () => {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(systemText && { system: systemText }),
      messages: conversationMessages,
      ...(useWebSearch && {
        // Built-in server-side web search — no tool_result loop needed
        tools: [{ type: 'web_search_20250305' as const }],
      }),
    });

    logUsage(response.usage, model);
    return extractText(response.content);
  });
}

/**
 * JSON completion — expects the model to return a JSON object/array.
 * Strips markdown code fences that some prompts elicit.
 */
export async function chatJSON<T>(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<T> {
  const raw = await chat(messages, options);
  const cleaned = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```$/m, '')
    .trim();
  return JSON.parse(cleaned) as T;
}
