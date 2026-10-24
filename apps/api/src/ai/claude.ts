/**
 * Backend-only Claude integration (Messages API). API keys never leave the server; browser and
 * mobile clients call FORGEHSE endpoints, never Anthropic directly.
 *
 * Prompt caching: the stable system prefix (identical for every tenant) carries the cache
 * breakpoint; tool definitions precede it in the cached prefix. Tenant data only ever appears
 * in later, uncached system blocks or in messages.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { HttpError } from '../http/core';
import { STABLE_SYSTEM_PROMPT, estimateTokens, PROMPT_VERSION } from './prompts';
import { estimateCost, type Pricing, type Usage, type CostBreakdown } from './pricing';

export interface ClaudeOptions {
  apiKey?: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  cacheTtl: '5m' | '1h';
  pricing: Pricing;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

export type CacheStatus = 'hit' | 'write' | 'miss' | 'not_requested' | 'error';
type CacheControl = { type: 'ephemeral'; ttl?: '1h' };

export type TextBlock = { type: 'text'; text: string; cache_control?: CacheControl };
export type DocumentBlock = { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } | { type: 'text'; media_type: 'text/plain'; data: string }; title?: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; cache_control?: CacheControl };
export type ContentBlock = TextBlock | DocumentBlock | ToolUseBlock | ToolResultBlock;
export interface MessageParam { role: 'user' | 'assistant'; content: ContentBlock[] }
export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system: TextBlock[];
  messages: MessageParam[];
  tools?: ToolDef[];
  tool_choice?: { type: 'auto' } | { type: 'any' } | { type: 'none' } | { type: 'tool'; name: string };
  stream?: boolean;
}
/** Kept for the v0.1 single-shot tests. */
export type ClaudeRequestBody = MessagesRequest;

export interface ClaudeCallResult {
  text: string;
  content: ContentBlock[];
  stopReason: string | null;
  usage: Usage;
  cacheStatus: CacheStatus;
  cost: CostBreakdown;
  latencyMs: number;
  model: string;
  stablePrefixTokensEst: number;
}

export class AiError extends HttpError {
  constructor(status: number, code: string, message: string, public upstreamStatus?: number) {
    super(status, code, message);
  }
}

export interface PreparedRequest { body: MessagesRequest; cacheRequested: boolean; stablePrefixTokensEst: number }

export class ClaudeService {
  constructor(private opts: ClaudeOptions) {}

  get configured() { return Boolean(this.opts.apiKey); }
  get model() { return this.opts.model; }
  get pricing() { return this.opts.pricing; }
  get cacheTtl() { return this.opts.cacheTtl; }

  /**
   * Request skeleton: stable system prefix (cache breakpoint) + optional dynamic system block (never cached).
   * cache_control is only attached when the prefix meets the model's minimum cacheable length; below it the
   * API would silently skip caching, so we record `not_requested` honestly.
   */
  prepare(parts: { messages: MessageParam[]; dynamicSystem?: string; tools?: ToolDef[]; toolChoice?: MessagesRequest['tool_choice']; maxTokens?: number }): PreparedRequest {
    const est = estimateTokens(STABLE_SYSTEM_PROMPT) + estimateTokens(JSON.stringify(parts.tools ?? []));
    const min = this.opts.pricing.models[this.opts.model]?.minCacheableTokens ?? 4096; // unknown model → conservative
    const cacheRequested = est >= min;
    const system: TextBlock[] = [{ type: 'text', text: STABLE_SYSTEM_PROMPT }];
    if (cacheRequested) system[0]!.cache_control = this.cacheControl();
    if (parts.dynamicSystem) system.push({ type: 'text', text: parts.dynamicSystem });
    const body: MessagesRequest = { model: this.opts.model, max_tokens: parts.maxTokens ?? this.opts.maxTokens, system, messages: parts.messages };
    if (parts.tools?.length) body.tools = parts.tools;
    if (parts.toolChoice) body.tool_choice = parts.toolChoice;
    return { body, cacheRequested, stablePrefixTokensEst: est };
  }

  cacheControl(): CacheControl { return this.opts.cacheTtl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }; }

  /** v0.1 single-shot request shape (one user message). */
  buildRequest(userMessage: string): PreparedRequest {
    return this.prepare({ messages: [{ role: 'user', content: [{ type: 'text', text: userMessage }] }] });
  }

  async complete(userMessage: string): Promise<ClaudeCallResult> {
    return this.send(this.buildRequest(userMessage));
  }

  /** Non-streaming call. */
  async send(prep: PreparedRequest, signal?: AbortSignal): Promise<ClaudeCallResult> {
    const started = Date.now();
    const res = await this.post(prep.body, signal, this.opts.timeoutMs);
    const data = (await res.json()) as { content?: ContentBlock[]; stop_reason?: string; usage?: Partial<Usage>; model?: string };
    return this.result(prep, data.content ?? [], data.stop_reason ?? null, data.usage ?? {}, data.model, started);
  }

  /**
   * Streaming call: `onText` receives text deltas as they arrive; tool_use blocks are assembled from
   * their JSON deltas. Resolves with the complete message once `message_stop` arrives.
   */
  async stream(prep: PreparedRequest, onText: (t: string) => void, signal?: AbortSignal): Promise<ClaudeCallResult> {
    const started = Date.now();
    const res = await this.post({ ...prep.body, stream: true }, signal, Math.max(this.opts.timeoutMs, 120_000));
    if (!res.body) throw new AiError(502, 'ai_upstream_error', 'The AI service returned an empty stream.');
    const blocks: (ContentBlock & { _json?: string })[] = [];
    const usage: Partial<Usage> = {};
    let stopReason: string | null = null;
    let model: string | undefined;
    let done = false;
    const handle = (event: string, data: any) => {
      switch (event) {
        case 'message_start':
          model = data.message?.model;
          Object.assign(usage, data.message?.usage ?? {});
          break;
        case 'content_block_start': {
          const b = data.content_block ?? {};
          blocks[data.index] = b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: {}, _json: '' } : { type: 'text', text: b.text ?? '' };
          break;
        }
        case 'content_block_delta': {
          const b = blocks[data.index];
          if (!b) break;
          if (data.delta?.type === 'text_delta' && b.type === 'text') { b.text += data.delta.text; onText(data.delta.text); }
          if (data.delta?.type === 'input_json_delta' && b.type === 'tool_use') b._json += data.delta.partial_json ?? '';
          break;
        }
        case 'content_block_stop': {
          const b = blocks[data.index];
          if (b?.type === 'tool_use') {
            try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; }
            delete b._json;
          }
          break;
        }
        case 'message_delta':
          stopReason = data.delta?.stop_reason ?? stopReason;
          if (data.usage) Object.assign(usage, Object.fromEntries(Object.entries(data.usage).filter(([, v]) => v != null)));
          break;
        case 'message_stop':
          done = true;
          break;
        case 'error': {
          const type = data.error?.type ?? 'api_error';
          throw type === 'overloaded_error'
            ? new AiError(503, 'ai_overloaded', 'The AI service is busy. Please try again in a moment.')
            : new AiError(502, 'ai_upstream_error', 'The AI service reported an error while answering. Please try again.');
        }
      }
    };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (!done) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let event = 'message';
          const dataLines: string[] = [];
          for (const ln of raw.split('\n')) {
            if (ln.startsWith('event:')) event = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataLines.push(ln.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          let data: unknown;
          try { data = JSON.parse(dataLines.join('\n')); } catch { continue; }
          handle(event, data);
        }
      }
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (signal?.aborted) throw new AiError(499, 'ai_cancelled', 'The request was cancelled.');
      throw new AiError(502, 'ai_stream_interrupted', 'The AI answer was interrupted. Please try again.');
    } finally {
      reader.releaseLock?.();
    }
    if (!done) throw new AiError(502, 'ai_stream_interrupted', 'The AI answer was interrupted. Please try again.');
    return this.result(prep, blocks.filter(Boolean) as ContentBlock[], stopReason, usage, model, started);
  }

  private result(prep: PreparedRequest, content: ContentBlock[], stopReason: string | null, u: Partial<Usage>, model: string | undefined, started: number): ClaudeCallResult {
    const usage: Usage = {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation: u.cache_creation ?? null,
    };
    const cacheStatus: CacheStatus = (usage.cache_read_input_tokens ?? 0) > 0 ? 'hit'
      : (usage.cache_creation_input_tokens ?? 0) > 0 ? 'write'
      : prep.cacheRequested ? 'miss' : 'not_requested';
    return {
      text: content.filter((c): c is TextBlock => c.type === 'text').map((c) => c.text).join(''),
      content,
      stopReason,
      usage,
      cacheStatus,
      cost: estimateCost(this.opts.pricing, this.opts.model, usage, this.opts.cacheTtl),
      latencyMs: Date.now() - started,
      model: model ?? this.opts.model,
      stablePrefixTokensEst: prep.stablePrefixTokensEst,
    };
  }

  /** POST with timeout, retry on transient failures (before any response is consumed) and error mapping. */
  private async post(body: MessagesRequest, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
    if (!this.opts.apiKey) throw new AiError(503, 'ai_not_configured', 'The AI assistant is not configured on this server. Ask your administrator to set ANTHROPIC_API_KEY.');
    const doFetch = this.opts.fetchImpl ?? fetch;
    const maxRetries = this.opts.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new AiError(499, 'ai_cancelled', 'The request was cancelled.');
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      const relay = () => ac.abort();
      signal?.addEventListener('abort', relay, { once: true });
      let res: Response;
      try {
        res = await doFetch(`${this.opts.baseUrl.replace(/\/$/, '')}/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': this.opts.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', relay);
        if (signal?.aborted) throw new AiError(499, 'ai_cancelled', 'The request was cancelled.');
        if (attempt < maxRetries && (e as Error).name !== 'AbortError') { await sleep(500 * 2 ** attempt); continue; }
        throw (e as Error).name === 'AbortError'
          ? new AiError(504, 'ai_timeout', 'The AI service took too long to respond. Please try again.')
          : new AiError(502, 'ai_unreachable', 'The AI service could not be reached. Please try again later.');
      }
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
      if (res.ok) return res;

      const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      if (retryable && attempt < maxRetries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 20) * 1000 : 800 * 2 ** attempt);
        continue;
      }
      // Never forward upstream error bodies to clients: they can contain request details.
      if (res.status === 401 || res.status === 403) throw new AiError(502, 'ai_auth_failed', 'The AI service rejected the server credentials. Contact your administrator.', res.status);
      if (res.status === 429) throw new AiError(429, 'ai_rate_limited', 'The AI service is busy. Please try again in a minute.', res.status);
      if (res.status === 400) throw new AiError(502, 'ai_bad_request', 'The AI request could not be processed.', res.status);
      throw new AiError(502, 'ai_upstream_error', 'The AI service returned an error. Please try again later.', res.status);
    }
  }
}

export { PROMPT_VERSION };

/** Extract the first JSON object from a model reply (tolerates code fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiError(502, 'ai_bad_output', 'The AI reply was not in the expected format. Please try again.');
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { throw new AiError(502, 'ai_bad_output', 'The AI reply was not in the expected format. Please try again.'); }
}
