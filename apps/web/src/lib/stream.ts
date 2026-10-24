/** Client for the streaming chat endpoint (Server-Sent Events over a POST fetch). */
import { ApiError } from './api';

export interface Citation { id: string; refNo: string; title: string; cited: boolean }
export type ChatAction =
  | { type: 'generate'; kind: 'checklist' | 'document' | 'poster' | 'flowchart'; brief: string; documentType?: string }
  | { type: 'draft_observation'; notes: string };

export interface ChatHandlers {
  onMeta?: (d: { conversationId: string }) => void;
  onDelta?: (text: string) => void;
  onTool?: (d: { id: string; name: string; status: 'running' | 'done' | 'error'; summary?: string }) => void;
  onAction?: (a: ChatAction) => void;
  onDone?: (d: { messageId: string; citations: Citation[]; truncated: boolean; disclaimer: string; cacheStatus?: string }) => void;
}

export async function streamChat(body: { message: string; conversationId?: string; projectId?: string }, h: ChatHandlers, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch('/api/ai/chat', {
      method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'forgehse', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`);
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message', data = '';
      for (const ln of block.split('\n')) {
        if (ln.startsWith('event:')) event = ln.slice(6).trim();
        else if (ln.startsWith('data:')) data += ln.slice(5).trimStart();
      }
      if (!data) continue;
      const d = JSON.parse(data);
      if (event === 'meta') h.onMeta?.(d);
      else if (event === 'delta') h.onDelta?.(d.text);
      else if (event === 'tool') h.onTool?.(d);
      else if (event === 'action') h.onAction?.(d);
      else if (event === 'done') { finished = true; h.onDone?.(d); }
      else if (event === 'error') throw new ApiError(d.status ?? 500, d.code ?? 'error', d.message ?? 'The assistant failed.');
    }
  }
  if (!finished) throw new ApiError(0, 'interrupted', 'The answer was interrupted. Please try again.');
}
