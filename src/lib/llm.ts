/**
 * OpenAI-compatible LLM client (LM Studio).
 * Runtime: LM Studio at http://localhost:1234/v1 — no @anthropic-ai/sdk.
 * Uses Node's built-in http module directly to avoid undici headersTimeout issues
 * with large model prompts (Korean article batches can take 60s+ before first byte).
 */

import * as http from 'node:http';

const LLM_BASE = (process.env.LLM_BASE_URL ?? 'http://localhost:1234/v1').replace(/\/$/, '');
const LLM_MODEL = process.env.LLM_MODEL ?? 'qwen3.6-35b-a3b-mlx';
// LM Studio server has API-token auth enabled — requests without a Bearer token get 401.
const LLM_API_KEY = process.env.LLM_API_KEY ?? '';

// Guard: reject any backend that isn't LM Studio on localhost:1234
if (!LLM_BASE.includes('localhost:1234')) {
  throw new Error(
    `[llm.ts] Forbidden LLM backend: "${LLM_BASE}". Only localhost:1234 (LM Studio) is allowed. ` +
    `Check LLM_BASE_URL env var — Ollama (localhost:11434) is permanently abandoned.`
  );
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  timeoutMs?: number;
  /**
   * JSON Schema for structured output (LM Studio response_format json_schema).
   * When set, the server constrains decoding to the schema; if the server
   * rejects response_format, the call is retried once without it.
   */
  schema?: Record<string, unknown>;
}

interface ChatChoice {
  message: { role: string; content: string; reasoning?: string };
  finish_reason: string;
}

interface ChatCompletionResponse {
  choices: ChatChoice[];
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
        ...(LLM_API_KEY && { Authorization: `Bearer ${LLM_API_KEY}` }),
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`LLM error ${res.statusCode}: ${text.slice(0, 200)}`));
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

let _resolvedModel: string | null = null;

/** Returns LLM_MODEL if available, otherwise falls back to first loaded model. */
async function fetchAvailableModel(): Promise<string> {
  if (_resolvedModel) return _resolvedModel;
  return new Promise((resolve) => {
    const url = new URL(`${LLM_BASE}/models`);
    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        headers: { ...(LLM_API_KEY && { Authorization: `Bearer ${LLM_API_KEY}` }) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            const models: Array<{ id: string }> = data?.data ?? [];
            const match = models.find((m) => m.id === LLM_MODEL) ?? models[0];
            _resolvedModel = match?.id ?? LLM_MODEL;
          } catch { _resolvedModel = LLM_MODEL; }
          resolve(_resolvedModel!);
        });
        res.on('error', () => { _resolvedModel = LLM_MODEL; resolve(_resolvedModel!); });
      },
    );
    req.on('error', () => { _resolvedModel = LLM_MODEL; resolve(_resolvedModel!); });
    req.setTimeout(5000, () => { req.destroy(); _resolvedModel = LLM_MODEL; resolve(_resolvedModel!); });
  });
}

async function callLLM(
  messages: ChatMessage[],
  options: ChatOptions & { jsonMode?: boolean } = {},
): Promise<string> {
  const modelId = options.model ?? await fetchAvailableModel();
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  };

  // Structured output: response_format json_schema is attempted first when a schema
  // is given, but verified 2026-07-03: qwen3.6-35b-a3b-mlx on this LM Studio build
  // returns EMPTY content under json_schema (grammar unsupported on the MLX engine).
  // So any schema failure — HTTP error or empty content — falls back to the
  // prompt-level "순수 JSON만 출력" + repair/extract path, which works reliably.
  if (options.schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'response', schema: options.schema },
    };
  }

  for (let attempt = options.schema ? 0 : 1; attempt < 2; attempt++) {
    if (attempt === 1) delete body.response_format;
    let text: string;
    try {
      text = await httpPost(`${LLM_BASE}/chat/completions`, JSON.stringify(body), options.timeoutMs);
    } catch (err) {
      if (attempt === 0 && /response_format|json_schema/.test(String(err))) {
        console.warn('[llm] server rejected response_format json_schema — retrying without it');
        continue;
      }
      throw err;
    }
    const data = JSON.parse(text) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    if (content.trim()) return content;
    if (attempt === 0) {
      console.warn('[llm] empty content under json_schema — retrying without response_format');
      continue;
    }
    throw new Error('LLM returned no content');
  }
  throw new Error('LLM returned no content');
}

/** Plain text completion. */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  return callLLM(messages, options);
}

/**
 * JSON completion — instructs the model to return pure JSON.
 * The caller's type parameter T describes the expected shape.
 */
export async function chatJSON<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
  const raw = await callLLM(messages, { ...options, jsonMode: true });

  // Strip markdown code fences the model sometimes adds
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

/** Health check — returns true if LLM server is reachable. */
export async function isLLMHealthy(): Promise<boolean> {
  try {
    const res = await httpPost(
      `${LLM_BASE}/chat/completions`,
      JSON.stringify({ model: LLM_MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
      10_000,
    ).catch(() => null);
    return res !== null;
  } catch {
    return false;
  }
}
