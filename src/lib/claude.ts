/**
 * LLM client shim — delegates to llm.ts (Ollama/LM Studio OpenAI-compatible).
 * Drop-in replacement for the former @anthropic-ai/sdk implementation.
 * useWebSearch is accepted but ignored (no server-side search at Ollama runtime).
 */

export type { ChatMessage, ChatOptions } from './llm';
export { chat, chatJSON, isLLMHealthy } from './llm';
