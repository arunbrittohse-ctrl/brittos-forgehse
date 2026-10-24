/**
 * Offline submission queue for field observations.
 *
 * Pure TypeScript (no React Native imports) so it is unit-tested in Node.
 *
 * Guarantees
 *  - Every queued observation carries a client-generated `clientRef` (UUID). The API treats
 *    it as an idempotency key, so a retry after a lost response never creates a duplicate.
 *  - Photos are uploaded only after the observation exists; progress is persisted per photo,
 *    so a retry resumes where it stopped instead of re-uploading.
 *  - Permanent failures (validation, permission) stop retrying and are shown to the user;
 *    transient failures (network, 5xx, 429) back off exponentially.
 *  - Only creates are queued. Status changes (assign, verify, close) need a live server
 *    authorisation check and are never performed offline.
 */

export interface QueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface QueuedPhoto { uri: string; name: string; mimeType: string; uploaded: boolean }

export interface QueuedObservation {
  clientRef: string;
  payload: Record<string, unknown>; // observationCreateSchema body (includes clientRef)
  photos: QueuedPhoto[];
  createdAt: string;
  state: 'pending' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  serverId?: string;
  refNo?: string;
  lastError?: string;
}

export interface SendResult { ok: true; id: string; refNo: string }
export class SendError extends Error {
  constructor(message: string, public permanent: boolean) { super(message); }
}

export interface Transport {
  createObservation(payload: Record<string, unknown>): Promise<SendResult>;
  uploadPhoto(observationId: string, photo: QueuedPhoto): Promise<void>;
}

const KEY = 'fhse.queue.v1';
const MAX_BACKOFF_MS = 15 * 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.max(0, attempts - 1));
}

/** Classify an HTTP status from the API into retryable or permanent. */
export function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429 && status !== 401;
}

export class OfflineQueue {
  private running: Promise<SyncSummary> | null = null;
  constructor(private storage: QueueStorage, private now: () => number = Date.now) {}

  async list(): Promise<QueuedObservation[]> {
    const raw = await this.storage.getItem(KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as QueuedObservation[]; } catch { return []; }
  }
  private async save(items: QueuedObservation[]) { await this.storage.setItem(KEY, JSON.stringify(items)); }

  /** Write progress for `items` while preserving anything enqueued meanwhile; drop `done` refs. */
  private async persist(items: QueuedObservation[], done: Set<string> = new Set()) {
    const mine = new Map(items.map((i) => [i.clientRef, i]));
    const latest = await this.list();
    await this.save(latest.filter((i) => !done.has(i.clientRef)).map((i) => mine.get(i.clientRef) ?? i));
  }

  async enqueue(payload: Record<string, unknown> & { clientRef: string }, photos: Omit<QueuedPhoto, 'uploaded'>[]): Promise<QueuedObservation> {
    const items = await this.list();
    const existing = items.find((i) => i.clientRef === payload.clientRef);
    if (existing) return existing; // double-tap on "Save" must not queue twice
    const item: QueuedObservation = {
      clientRef: payload.clientRef, payload, photos: photos.map((p) => ({ ...p, uploaded: false })),
      createdAt: new Date(this.now()).toISOString(), state: 'pending', attempts: 0, nextAttemptAt: 0,
    };
    await this.save([...items, item]);
    return item;
  }

  async remove(clientRef: string) { await this.save((await this.list()).filter((i) => i.clientRef !== clientRef)); }

  /** Put a permanently failed item back in the queue (e.g. after the user fixed their access). */
  async retry(clientRef: string) {
    const items = await this.list();
    for (const i of items) if (i.clientRef === clientRef) { i.state = 'pending'; i.nextAttemptAt = 0; i.lastError = undefined; }
    await this.save(items);
  }

  /** Process due items. Concurrent calls share one run. */
  sync(transport: Transport, opts: { force?: boolean } = {}): Promise<SyncSummary> {
    this.running ??= this.doSync(transport, opts).finally(() => { this.running = null; });
    return this.running;
  }

  private async doSync(transport: Transport, opts: { force?: boolean }): Promise<SyncSummary> {
    const summary: SyncSummary = { sent: [], failed: [], deferred: 0 };
    const items = await this.list();
    const done = new Set<string>();
    for (const item of items) {
      if (item.state === 'failed') continue;
      if (!opts.force && item.nextAttemptAt > this.now()) { summary.deferred++; continue; }
      try {
        if (!item.serverId) {
          const res = await transport.createObservation(item.payload);
          item.serverId = res.id;
          item.refNo = res.refNo;
          await this.persist(items); // persist progress before photos
        }
        for (const photo of item.photos) {
          if (photo.uploaded) continue;
          await transport.uploadPhoto(item.serverId, photo);
          photo.uploaded = true;
          await this.persist(items);
        }
        summary.sent.push({ clientRef: item.clientRef, refNo: item.refNo ?? '' });
        done.add(item.clientRef);
      } catch (e) {
        item.attempts++;
        item.lastError = (e as Error).message;
        if (e instanceof SendError && e.permanent) {
          item.state = 'failed';
          summary.failed.push({ clientRef: item.clientRef, error: item.lastError });
        } else {
          item.nextAttemptAt = this.now() + backoffMs(item.attempts);
          summary.deferred++;
        }
        await this.persist(items);
        if (!(e instanceof SendError && e.permanent)) break; // probably offline: stop hammering
      }
    }
    await this.persist(items, done);
    return summary;
  }
}

export interface SyncSummary {
  sent: { clientRef: string; refNo: string }[];
  failed: { clientRef: string; error: string }[];
  deferred: number;
}
