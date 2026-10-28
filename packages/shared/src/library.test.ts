import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expiryState, libraryMetaSchema, libraryVersionLifecycle, lifecycleProblems, checkTransition } from './index';

describe('document library rules', () => {
  it('expiry state', () => {
    assert.equal(expiryState(null, '2026-10-28'), 'none');
    assert.equal(expiryState('2026-10-27', '2026-10-28'), 'expired');
    assert.equal(expiryState('2026-10-28', '2026-10-28'), 'due_30');
    assert.equal(expiryState('2026-11-27', '2026-10-28'), 'due_30');
    assert.equal(expiryState('2026-11-28', '2026-10-28'), 'valid');
  });
  it('version lifecycle is well formed and keeps review independent', () => {
    assert.deepEqual(lifecycleProblems(libraryVersionLifecycle), []);
    assert.equal(checkTransition(libraryVersionLifecycle, 'approve', 'under_review', { actorId: 'a', submittedBy: 'a' }).ok, false);
    assert.equal(checkTransition(libraryVersionLifecycle, 'approve', 'under_review', { actorId: 'b', submittedBy: 'a' }).ok, true);
    assert.equal(checkTransition(libraryVersionLifecycle, 'reject', 'under_review', { actorId: 'b', submittedBy: 'a' }).ok, false, 'reason needed');
    assert.equal(checkTransition(libraryVersionLifecycle, 'approve', 'approved', { actorId: 'b' }).ok, false);
  });
  it('metadata validation', () => {
    const base = { title: 'Plan', docType: 'plan' };
    assert.equal(libraryMetaSchema.safeParse(base).success, true);
    assert.equal(libraryMetaSchema.safeParse({ ...base, siteId: '7d9f0b8e-1c55-4a8d-9a2b-2c3d4e5f6a7b' }).success, false, 'site without project');
    assert.equal(libraryMetaSchema.safeParse({ ...base, tags: ['ok', 'bad<tag>'] }).success, false);
    assert.equal(libraryMetaSchema.safeParse({ ...base, issueDate: '2026-02-01', expiryDate: '2026-01-01' }).success, false);
  });
});
