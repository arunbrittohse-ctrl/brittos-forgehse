/**
 * AI provider abstraction. FORGEHSE talks to every AI backend through one internal request
 * format (the Messages shape in ../claude.ts). A backend turns that request into content blocks.
 *
 *  - anthropic          optional, paid, external — Claude Messages API (built into ClaudeService)
 *  - local              free, deterministic rules/template engine inside the API — no model at all
 *  - openai_compatible  free if self-hosted — Ollama, LM Studio, llama.cpp, vLLM, LocalAI …
 *
 * Nothing in the HSE workflows depends on which backend is active, and no backend may bypass the
 * authorisation, validation and human-review steps that surround every AI call.
 */
import type { ContentBlock, MessagesRequest } from '../claude';
import type { Usage } from '../pricing';

export type AiProviderId = 'anthropic' | 'local' | 'openai_compatible' | 'off';

export interface BackendResult {
  content: ContentBlock[];
  stopReason: string | null;
  usage: Partial<Usage>;
  model?: string;
}

export interface AiBackend {
  readonly id: Exclude<AiProviderId, 'anthropic'>;
  /** Human-readable label shown in the UI next to every AI answer. */
  readonly label: string;
  readonly model: string;
  readonly configured: boolean;
  /** true when output comes from fixed rules/templates rather than a language model. */
  readonly deterministic: boolean;
  send(body: MessagesRequest, signal?: AbortSignal): Promise<BackendResult>;
  stream(body: MessagesRequest, onText: (t: string) => void, signal?: AbortSignal): Promise<BackendResult>;
}

export const ZERO_USAGE: Partial<Usage> = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
