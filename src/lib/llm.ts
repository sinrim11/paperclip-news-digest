/**
 * Ollama OpenAI-compatible LLM client.
 * Runtime: Ollama at http://localhost:11434/v1 — no @anthropic-ai/sdk.
 * Uses Node's built-in http module directly to avoid undici headersTimeout issues
 * with large model prompts (Korean article batches can take 60s+ before first byte).
 */

import * as http from 'node:http';

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
  message: { role: string; content: string; reasoning?: string };
  finish_reason: string;
}

interface OllamaResponse {
  choices: OllamaChoice[];
}

/** Make an HTTP POST request using node:http with configurable timeouts. */
function httpPost(url: string, body: string, timeoutMs = 600_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Ollama error ${res.statusCode}: ${text.slice(0, 200)}`));
        } else {
          resolve(text);
        }
      });
      res.on('error', reject);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callOllama(
  messages: ChatMessage[],
  options: ChatOptions & { jsonMode?: boolean } = {},
): Promise<string> {
  const nativeBase = OLLAMA_BASE.replace(/\/v1$/, '');

  if (options.jsonMode) {
    // Use native Ollama API with think:false to prevent gemma4's reasoning
    // from consuming the token budget and returning empty content
    const body = {
      model: options.model ?? OLLAMA_MODEL,
      messages,
      format: 'json',
      stream: false,
      think: false,
      options: {
        temperature: options.temperature ?? 0.3,
        num_predict: options.maxTokens ?? 4096,
      },
    };
    const text = await httpPost(`${nativeBase}/api/chat`, JSON.stringify(body));
    const data = JSON.parse(text) as { message?: { content?: string }; done_reason?: string };
    const content = data.message?.content ?? '';
    if (!content.trim()) {
      throw new Error(`Ollama returned no content (done_reason: ${data.done_reason})`);
    }
    return content;
  }

  // OpenAI-compatible endpoint for non-JSON calls
  const body = {
    model: options.model ?? OLLAMA_MODEL,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  };
  const text = await httpPost(`${OLLAMA_BASE}/chat/completions`, JSON.stringify(body));
  const data = JSON.parse(text) as OllamaResponse;
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
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

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const repaired = repairJson(cleaned);
    if (repaired !== null) {
      try { return JSON.parse(repaired) as T; } catch { /* fall through */ }
    }
    const extracted = extractJson(cleaned);
    if (extracted !== null) {
      try { return JSON.parse(extracted) as T; } catch {
        const repairedExtracted = repairJson(extracted);
        if (repairedExtracted !== null) return JSON.parse(repairedExtracted) as T;
      }
    }
    throw new SyntaxError(`JSON parse failed. Raw length: ${raw.length}. Preview: ${raw.slice(0, 200)}`);
  }
}

/** Repair common LLM JSON issues: trailing commas, unescaped newlines, unclosed structures. */
function repairJson(text: string): string | null {
  try {
    let s = text.trim();
    // Remove trailing commas before } or ]
    s = s.replace(/,\s*([}\]])/g, '$1');
    // Fix unescaped literal newlines inside strings
    s = s.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) =>
      match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'),
    );
    try { return JSON.parse(s) ? s : null; } catch { /* continue */ }
    // Try closing unclosed structures
    const extracted = extractJson(s);
    if (extracted) {
      const fixed = extracted.replace(/,\s*([}\]])/g, '$1');
      try { JSON.parse(fixed); return fixed; } catch { /* fall through */ }
    }
    return null;
  } catch { return null; }
}

/** Extract the first complete JSON object or array from a string using bracket matching. */
function extractJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  // Truncated JSON — close all open structures and retry
  const partial = text.slice(start);
  const repaired = partial + closer.repeat(depth);
  try { JSON.parse(repaired); return repaired; } catch { return null; }
}

/** Health check — returns true if Ollama is reachable. */
export async function isOllamaHealthy(): Promise<boolean> {
  try {
    const text = await httpPost(
      `${OLLAMA_BASE.replace('/v1', '')}/api/tags`,
      '{}',
      5_000,
    ).catch(() => null);
    return text !== null;
  } catch {
    return false;
  }
}
