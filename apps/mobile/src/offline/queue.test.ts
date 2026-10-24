import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OfflineQueue, SendError, backoffMs, isPermanentStatus, type QueueStorage, type Transport, type QueuedPhoto } from './queue';

class MemStore implements QueueStorage {
  data = new Map<string, string>();
  async getItem(k: string) { return this.data.get(k) ?? null; }
  async setItem(k: string, v: string) { this.data.set(k, v); }
}

function transport(script: { create?: (n: number) => void; upload?: (n: number, p: QueuedPhoto) => void } = {}) {
  const calls = { create: 0, upload: [] as string[], payloads: [] as Record<string, unknown>[] };
  const t: Transport = {
    async createObservation(payload) { calls.create++; calls.payloads.push(payload); script.create?.(calls.create); return { ok: true, id: 'srv-1', refNo: 'OBS-X-2026-00001' }; },
    async uploadPhoto(_id, photo) { script.upload?.(calls.upload.length + 1, photo); calls.upload.push(photo.name); },
  };
  return { t, calls };
}

const payload = (ref = 'ref-1') => ({ clientRef: ref, projectId: 'p', siteId: 's', description: 'x' });
const photos = [{ uri: 'file:///a.jpg', name: 'a.jpg', mimeType: 'image/jpeg' }, { uri: 'file:///b.jpg', name: 'b.jpg', mimeType: 'image/jpeg' }];

describe('offline queue', () => {
  it('sends queued observations with their clientRef and empties the queue', async () => {
    const q = new OfflineQueue(new MemStore());
    await q.enqueue(payload(), photos);
    const { t, calls } = transport();
    const s = await q.sync(t);
    assert.equal(s.sent.length, 1);
    assert.equal(calls.payloads[0]!.clientRef, 'ref-1');
    assert.deepEqual(calls.upload, ['a.jpg', 'b.jpg']);
    assert.equal((await q.list()).length, 0);
  });

  it('ignores a double-tap that enqueues the same clientRef twice', async () => {
    const q = new OfflineQueue(new MemStore());
    await q.enqueue(payload(), []);
    await q.enqueue(payload(), []);
    assert.equal((await q.list()).length, 1);
  });

  it('backs off after a network failure and keeps the item', async () => {
    let now = 1_000_000;
    const q = new OfflineQueue(new MemStore(), () => now);
    await q.enqueue(payload(), []);
    const { t } = transport({ create: () => { throw new Error('Network request failed'); } });
    const s = await q.sync(t);
    assert.equal(s.deferred, 1);
    const [item] = await q.list();
    assert.equal(item!.attempts, 1);
    assert.equal(item!.nextAttemptAt, now + 5000);
    // Not due yet → skipped without calling the server.
    const { t: t2, calls } = transport();
    await q.sync(t2);
    assert.equal(calls.create, 0);
    now += 5001;
    await q.sync(t2);
    assert.equal(calls.create, 1);
    assert.equal((await q.list()).length, 0);
  });

  it('resumes photo uploads without re-creating the observation (no duplicates)', async () => {
    const store = new MemStore();
    const q = new OfflineQueue(store);
    await q.enqueue(payload(), photos);
    const first = transport({ upload: (n) => { if (n === 2) throw new Error('timeout'); } });
    await q.sync(first.t);
    assert.equal(first.calls.create, 1);
    assert.deepEqual(first.calls.upload, ['a.jpg']);
    const [pending] = await q.list();
    assert.equal(pending!.serverId, 'srv-1');
    // App restarts: a fresh queue instance on the same storage.
    const q2 = new OfflineQueue(store);
    const second = transport();
    await q2.sync(second.t, { force: true });
    assert.equal(second.calls.create, 0, 'observation is not sent again');
    assert.deepEqual(second.calls.upload, ['b.jpg']);
    assert.equal((await q2.list()).length, 0);
  });

  it('marks permanent failures (e.g. 403/400) and stops retrying until the user acts', async () => {
    const q = new OfflineQueue(new MemStore());
    await q.enqueue(payload('a'), []);
    await q.enqueue(payload('b'), []);
    const { t, calls } = transport({ create: (n) => { if (n === 1) throw new SendError('You do not have permission', true); } });
    const s = await q.sync(t);
    assert.equal(s.failed.length, 1);
    assert.equal(s.sent.length, 1, 'a permanent failure does not block later items');
    const list = await q.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.state, 'failed');
    await q.sync(t);
    assert.equal(calls.create, 2, 'failed item is not retried automatically');
    await q.retry('a');
    assert.equal((await q.list())[0]!.state, 'pending');
  });

  it('shares one run between concurrent sync calls', async () => {
    const q = new OfflineQueue(new MemStore());
    await q.enqueue(payload(), []);
    const { t, calls } = transport();
    await Promise.all([q.sync(t), q.sync(t), q.sync(t)]);
    assert.equal(calls.create, 1);
  });

  it('keeps observations enqueued while a sync is running', async () => {
    const q = new OfflineQueue(new MemStore());
    await q.enqueue(payload('first'), photos);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const t: Transport = {
      async createObservation() { return { ok: true, id: 'srv', refNo: 'R' }; },
      async uploadPhoto() { await gate; },
    };
    const run = q.sync(t);
    await new Promise((r) => setTimeout(r, 5));
    await q.enqueue(payload('second'), []);
    release();
    await run;
    assert.deepEqual((await q.list()).map((i) => i.clientRef), ['second']);
  });

  it('classifies HTTP statuses and caps backoff', () => {
    assert.equal(isPermanentStatus(400), true);
    assert.equal(isPermanentStatus(403), true);
    assert.equal(isPermanentStatus(429), false);
    assert.equal(isPermanentStatus(401), false, 'expired session: re-login then retry');
    assert.equal(isPermanentStatus(503), false);
    assert.equal(backoffMs(1), 5000);
    assert.equal(backoffMs(20), 15 * 60_000);
  });

  it('survives corrupted storage', async () => {
    const store = new MemStore();
    store.data.set('fhse.queue.v1', '{not json');
    assert.deepEqual(await new OfflineQueue(store).list(), []);
  });
});
