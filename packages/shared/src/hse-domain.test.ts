import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HSE_DOMAINS,
  HSE_RECORD_STATUSES,
  assertHseStatusTransition,
  canTransitionHseStatus,
  hseRecordCreateSchema,
} from './hse-domain';

test('foundation enumerates the planned HSE domains', () => {
  assert.ok(HSE_DOMAINS.includes('permit'));
  assert.ok(HSE_DOMAINS.includes('incident'));
  assert.ok(HSE_DOMAINS.includes('man_hours'));
  assert.equal(HSE_RECORD_STATUSES.includes('draft'), true);
});

test('common lifecycle permits a draft to be submitted', () => {
  assert.equal(canTransitionHseStatus('draft', 'submitted'), true);
  assert.doesNotThrow(() => assertHseStatusTransition('draft', 'submitted'));
});

test('common lifecycle blocks an invalid transition', () => {
  assert.equal(canTransitionHseStatus('draft', 'closed'), false);
  assert.throws(() => assertHseStatusTransition('draft', 'closed'), /Invalid HSE record transition/);
});

test('record create schema validates required metadata and defaults', () => {
  const parsed = hseRecordCreateSchema.parse({
    domain: 'permit',
    organizationId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    title: 'Hot work permit',
  });
  assert.equal(parsed.status, 'draft');
  assert.deepEqual(parsed.payload, {});
  assert.equal(parsed.description, '');
});

test('record create schema rejects invalid domain and short title', () => {
  const base = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    title: 'x',
  };
  assert.equal(hseRecordCreateSchema.safeParse({ ...base, domain: 'unknown' }).success, false);
  assert.equal(hseRecordCreateSchema.safeParse({ ...base, domain: 'incident' }).success, false);
});
