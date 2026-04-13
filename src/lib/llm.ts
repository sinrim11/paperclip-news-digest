/**
 * Ollama OpenAI-compatible LLM client.
 * Runtime: Ollama at http://localhost:11434/v1 — no @anthropic-ai/sdk.
 * Drop-in replacement for the claude.ts the docs describe.
 */

const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:26b';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

interface OllamaChoice {
  message: { role: string; content: string };
  finish_reason: string;
}

interface OllamaResponse {
  choices: OllamaChoice[];
}

async function callOllama(
  messages: ChatMessage[],
  options: ChatOptions & { jsonMode?: boolean } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model ?? OLLAMA_MODEL,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  };

  if (options.jsonMode) {
    body.format = 'json';
  }

  const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Node 18+ supports signal; add a generous timeout for large models
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as OllamaResponse;
  const content = data.choices?.[0]?.message?.content;

  if (content === undefined || content === null) {
    throw new Error('Ollama returned no content');
  }

  return content;
}

/** Plain text completion. */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  return callOllama(messages, options);
}

/**
 * JSON completion — instructs the model to return pure JSON.
 * The caller's type parameter T describes the expected shape.
 */
export async function chatJSON<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
  const raw = await callOllama(messages, { ...options, jsonMode: true });

  // Strip markdown code fences Ollama sometimes adds
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  return JSON.parse(cleaned) as T;
}

/** Health check — returns true if Ollama is reachable. */
export async function isOllamaHealthy(): Promise<boolean> {
  try {
    const res = await fetch(
      `${OLLAMA_BASE.replace('/v1', '')}/api/tags`,
      { signal: AbortSignal.timeout(5_000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}
