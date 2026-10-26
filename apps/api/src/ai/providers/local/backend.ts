import type { ContentBlock, MessagesRequest } from '../../claude';
import { AiError } from '../../claude';
import type { AiBackend, BackendResult } from '../types';
import { ZERO_USAGE } from '../types';
import { planResponse, LocalEngineError, LOCAL_MODEL } from './engine';

/** Free, deterministic backend: the FORGEHSE local rules engine. Same input → same output. */
export class LocalRulesBackend implements AiBackend {
  readonly id = 'local' as const;
  readonly label = 'FORGEHSE local rules engine (no AI model)';
  readonly model = LOCAL_MODEL;
  readonly configured = true;
  readonly deterministic = true;

  async send(body: MessagesRequest, signal?: AbortSignal): Promise<BackendResult> {
    if (signal?.aborted) throw new AiError(499, 'ai_cancelled', 'The request was cancelled.');
    let plan;
    try {
      plan = planResponse(body);
    } catch (e) {
      if (e instanceof LocalEngineError) throw new AiError(422, e.code, e.message);
      throw new AiError(500, 'ai_local_failed', 'The local rules engine could not prepare a reply.');
    }
    const content: ContentBlock[] = [];
    if (plan.text) content.push({ type: 'text', text: plan.text });
    (plan.tools ?? []).forEach((t, i) => content.push({ type: 'tool_use', id: `toolu_local_${i}_${t.name}`, name: t.name, input: t.input }));
    return { content, stopReason: plan.tools?.length ? 'tool_use' : 'end_turn', usage: { ...ZERO_USAGE }, model: this.model };
  }

  async stream(body: MessagesRequest, onText: (t: string) => void, signal?: AbortSignal): Promise<BackendResult> {
    const r = await this.send(body, signal);
    for (const b of r.content) {
      if (b.type !== 'text') continue;
      // Deliver in word-sized pieces so the streaming UI behaves exactly as with a model.
      for (const piece of b.text.match(/\S+\s*|\s+/g) ?? []) {
        if (signal?.aborted) throw new AiError(499, 'ai_cancelled', 'The request was cancelled.');
        onText(piece);
      }
    }
    return r;
  }
}
