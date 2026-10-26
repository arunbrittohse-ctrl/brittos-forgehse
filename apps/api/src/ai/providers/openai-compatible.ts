/**
 * Adapter for any OpenAI-compatible chat-completions server, so FORGEHSE can use a free,
 * self-hosted open model: Ollama (`http://127.0.0.1:11434/v1`), LM Studio, llama.cpp server,
 * vLLM, LocalAI and similar. Converts the internal Messages request to /v1/chat/completions,
 * including tools and tool results, and converts replies (plain or streamed) back.
 *
 * Small local models follow tool schemas less reliably than large hosted ones; every structured
 * reply is still validated by the server, and invalid output is rejected, never stored.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { AiError, type ContentBlock, type MessagesRequest } from '../claude';
import type { AiBackend, BackendResult } from './types';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

type OaMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toChatCompletions(body: MessagesRequest, model: string) {
  const messages: OaMessage[] = [{ role: 'system', content: body.system.map((s) => s.text).join('\n\n') }];
  for (const m of body.messages) {
    if (m.role === 'user') {
      const text: string[] = [];
      for (const c of m.content) {
        if (c.type === 'text') text.push(c.text);
        else if (c.type === 'document') {
          text.push(c.source.type === 'text'
            ? `<document title="${(c.title ?? 'document').replace(/"/g, '')}">\n${c.source.data}\n</document>`
            : '[A PDF was attached, but this model endpoint cannot read PDF files. Say so instead of guessing its content.]');
        } else if (c.type === 'tool_result') {
          messages.push({ role: 'tool', tool_call_id: c.tool_use_id, content: c.content });
        }
      }
      if (text.length) messages.push({ role: 'user', content: text.join('\n\n') });
    } else {
      const text = m.content.filter((c): c is Extract<ContentBlock, { type: 'text' }> => c.type === 'text').map((c) => c.text).join('');
      const calls = m.content.filter((c): c is Extract<ContentBlock, { type: 'tool_use' }> => c.type === 'tool_use')
        .map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } }));
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    }
  }
  const out: Record<string, unknown> = { model, messages, max_tokens: body.max_tokens };
  if (body.tools?.length && body.tool_choice?.type !== 'none') {
    out.tools = body.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const tc = body.tool_choice;
    if (tc?.type === 'tool') out.tool_choice = { type: 'function', function: { name: tc.name } };
    else if (tc?.type === 'any') out.tool_choice = 'required';
    else out.tool_choice = 'auto';
  }
  return out;
}

const STOP: Record<string, string> = { tool_calls: 'tool_use', function_call: 'tool_use', length: 'max_tokens', stop: 'end_turn', content_filter: 'refusal' };

function parseArgs(s: string): unknown {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

export class OpenAiCompatibleBackend implements AiBackend {
  readonly id = 'openai_compatible' as const;
  readonly deterministic = false;
  constructor(private opts: OpenAiCompatibleOptions) {}
  get label() { return `Self-hosted model (${this.opts.model})`; }
  get model() { return this.opts.model; }
  get configured() { return Boolean(this.opts.baseUrl && this.opts.model); }

  async send(body: MessagesRequest, signal?: AbortSignal): Promise<BackendResult> {
    const res = await this.post(toChatCompletions(body, this.opts.model), signal, this.opts.timeoutMs);
    const data = (await res.json()) as { model?: string; choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const choice = data.choices?.[0];
    const content: ContentBlock[] = [];
    if (choice?.message?.content) content.push({ type: 'text', text: choice.message.content });
    (choice?.message?.tool_calls ?? []).forEach((c, i) => content.push({ type: 'tool_use', id: c.id ?? `call_${i}`, name: c.function?.name ?? '', input: parseArgs(c.function?.arguments ?? '') }));
    const hasTools = content.some((c) => c.type === 'tool_use');
    return {
      content,
      stopReason: hasTools ? 'tool_use' : STOP[choice?.finish_reason ?? 'stop'] ?? 'end_turn',
      usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      model: data.model ?? this.opts.model,
    };
  }

  async stream(body: MessagesRequest, onText: (t: string) => void, signal?: AbortSignal): Promise<BackendResult> {
    const req = { ...toChatCompletions(body, this.opts.model), stream: true, stream_options: { include_usage: true } };
    const res = await this.post(req, signal, Math.max(this.opts.timeoutMs, 120_000));
    if (!res.body) throw new AiError(502, 'ai_upstream_error', 'The AI service returned an empty stream.');
    let text = '';
    const calls: { id: string; name: string; args: string }[] = [];
    let finish: string | null = null;
    let model: string | undefined;
    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    let done = false;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (!done) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { done = true; break; }
          let d: any;
          try { d = JSON.parse(payload); } catch { continue; }
          model ??= d.model;
          if (d.usage) { usage.input_tokens = d.usage.prompt_tokens ?? 0; usage.output_tokens = d.usage.completion_tokens ?? 0; }
          const ch = d.choices?.[0];
          if (!ch) continue;
          const delta = ch.delta ?? {};
          if (typeof delta.content === 'string' && delta.content) { text += delta.content; onText(delta.content); }
          for (const tc of delta.tool_calls ?? []) {
            const k = typeof tc.index === 'number' ? tc.index : calls.length;
            calls[k] ??= { id: tc.id ?? `call_${k}`, name: '', args: '' };
            if (tc.id) calls[k]!.id = tc.id;
            if (tc.function?.name) calls[k]!.name += tc.function.name;
            if (tc.function?.arguments) calls[k]!.args += tc.function.arguments;
          }
          if (ch.finish_reason) finish = ch.finish_reason;
        }
      }
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (signal?.aborted) throw new AiError(499, 'ai_cancelled', 'The request was cancelled.');
      throw new AiError(502, 'ai_stream_interrupted', 'The AI answer was interrupted. Please try again.');
    } finally {
      reader.releaseLock?.();
    }
    if (!done && !finish) throw new AiError(502, 'ai_stream_interrupted', 'The AI answer was interrupted. Please try again.');
    const content: ContentBlock[] = [];
    if (text) content.push({ type: 'text', text });
    calls.filter(Boolean).forEach((c) => content.push({ type: 'tool_use', id: c.id, name: c.name, input: parseArgs(c.args) }));
    return { content, stopReason: calls.length ? 'tool_use' : STOP[finish ?? 'stop'] ?? 'end_turn', usage, model: model ?? this.opts.model };
  }

  private async post(body: unknown, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const maxRetries = this.opts.maxRetries ?? 1;
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new AiError(499, 'ai_cancelled', 'The request was cancelled.');
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      const relay = () => ac.abort();
      signal?.addEventListener('abort', relay, { once: true });
      let res: Response;
      try {
        res = await doFetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
      } catch (e) {
        clearTimeout(timer); signal?.removeEventListener('abort', relay);
        if (signal?.aborted) throw new AiError(499, 'ai_cancelled', 'The request was cancelled.');
        if (attempt < maxRetries && (e as Error).name !== 'AbortError') { await sleep(500 * 2 ** attempt); continue; }
        throw (e as Error).name === 'AbortError'
          ? new AiError(504, 'ai_timeout', 'The local model took too long to respond. Try a shorter request or a smaller model.')
          : new AiError(502, 'ai_unreachable', 'The local model server could not be reached. Check that it is running.');
      }
      clearTimeout(timer); signal?.removeEventListener('abort', relay);
      if (res.ok) return res;
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) { await sleep(800 * 2 ** attempt); continue; }
      // Upstream bodies are never forwarded to clients.
      if (res.status === 401 || res.status === 403) throw new AiError(502, 'ai_auth_failed', 'The model server rejected the server credentials. Contact your administrator.', res.status);
      if (res.status === 404) throw new AiError(502, 'ai_model_missing', 'The configured model is not available on the model server. Contact your administrator.', res.status);
      throw new AiError(502, 'ai_upstream_error', 'The model server returned an error. Please try again later.', res.status);
    }
  }
}
