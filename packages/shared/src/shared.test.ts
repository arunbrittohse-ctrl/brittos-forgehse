import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRisk, DEFAULT_RISK_MATRIX, RiskInputError, validateRiskMatrix,
  frequencyRate, onTimeClosureRate, totalManHours,
  can, scopesFor, roleHas, type RoleAssignment,
  allowedTransitions, observationCreateSchema, userCreateSchema,
} from './index';

describe('risk matrix', () => {
  it('scores likelihood × severity into default bands', () => {
    assert.deepEqual(calculateRisk(1, 1), { score: 1, band: 'low' });
    assert.deepEqual(calculateRisk(2, 2), { score: 4, band: 'low' });
    assert.deepEqual(calculateRisk(1, 5), { score: 5, band: 'medium' });
    assert.deepEqual(calculateRisk(3, 3), { score: 9, band: 'medium' });
    assert.deepEqual(calculateRisk(2, 5), { score: 10, band: 'high' });
    assert.deepEqual(calculateRisk(3, 5), { score: 15, band: 'critical' });
    assert.deepEqual(calculateRisk(5, 5), { score: 25, band: 'critical' });
  });
  it('rejects out-of-range or non-integer input', () => {
    assert.throws(() => calculateRisk(0, 3), RiskInputError);
    assert.throws(() => calculateRisk(6, 3), RiskInputError);
    assert.throws(() => calculateRisk(2.5, 3), RiskInputError);
  });
  it('supports a custom 3×3 matrix', () => {
    const m = { size: 3, bands: [{ band: 'low' as const, minScore: 1 }, { band: 'high' as const, minScore: 6 }] };
    validateRiskMatrix(m);
    assert.deepEqual(calculateRisk(2, 3, m), { score: 6, band: 'high' });
    assert.throws(() => calculateRisk(4, 1, m), RiskInputError);
  });
  it('validates band configuration', () => {
    validateRiskMatrix(DEFAULT_RISK_MATRIX);
    assert.throws(() => validateRiskMatrix({ size: 5, bands: [{ band: 'low', minScore: 2 }] }));
    assert.throws(() => validateRiskMatrix({ size: 5, bands: [{ band: 'low', minScore: 1 }, { band: 'high', minScore: 1 }] }));
  });
});

describe('KPI formulas', () => {
  it('computes frequency rates per base', () => {
    assert.equal(frequencyRate(2, 1_000_000), 2);
    assert.equal(frequencyRate(1, 400_000, 200_000), 0.5);
    assert.equal(frequencyRate(3, 1_234_567), 2.43);
  });
  it('returns null (not 0) when no hours are recorded', () => {
    assert.equal(frequencyRate(0, 0), null);
  });
  it('rejects negative input', () => {
    assert.throws(() => frequencyRate(-1, 10), RangeError);
  });
  it('computes on-time closure', () => {
    assert.equal(onTimeClosureRate(9, 12), 75);
    assert.equal(onTimeClosureRate(0, 0), null);
  });
  it('does not double count corrected man-hour entries', () => {
    const total = totalManHours([
      { siteId: 's1', date: '2026-10-01', employer: 'Main', hours: 800, revision: 1 },
      { siteId: 's1', date: '2026-10-01', employer: 'Main', hours: 820, revision: 2 },
      { siteId: 's1', date: '2026-10-01', employer: 'SubCo', hours: 200, revision: 1 },
      { siteId: 's2', date: '2026-10-01', employer: 'Main', hours: 100, revision: 1 },
    ]);
    assert.equal(total, 1120);
  });
});

describe('RBAC scope checks', () => {
  const ORG = 'org-1', OTHER = 'org-2', P1 = 'p1', P2 = 'p2', S1 = 's1', S2 = 's2';
  const corp: RoleAssignment[] = [{ organizationId: ORG, role: 'corporate_hse_manager', projectId: null, siteId: null }];
  const projEng: RoleAssignment[] = [{ organizationId: ORG, role: 'hse_engineer', projectId: P1, siteId: null }];
  const siteSup: RoleAssignment[] = [{ organizationId: ORG, role: 'supervisor', projectId: P1, siteId: S1 }];

  it('org-wide role covers every project but not other organisations', () => {
    assert.equal(can(corp, 'observation.verify', { organizationId: ORG, projectId: P2, siteId: S2 }), true);
    assert.equal(can(corp, 'observation.verify', { organizationId: OTHER, projectId: P2, siteId: S2 }), false);
  });
  it('project role is confined to its project', () => {
    assert.equal(can(projEng, 'observation.verify', { organizationId: ORG, projectId: P1, siteId: S2 }), true);
    assert.equal(can(projEng, 'observation.verify', { organizationId: ORG, projectId: P2, siteId: S2 }), false);
    assert.equal(can(projEng, 'observation.verify', { organizationId: ORG }), false); // not an org-wide grant
  });
  it('site role is confined to its site', () => {
    assert.equal(can(siteSup, 'observation.create', { organizationId: ORG, projectId: P1, siteId: S1 }), true);
    assert.equal(can(siteSup, 'observation.create', { organizationId: ORG, projectId: P1, siteId: S2 }), false);
  });
  it('permission must exist on the role', () => {
    assert.equal(can(siteSup, 'observation.verify', { organizationId: ORG, projectId: P1, siteId: S1 }), false);
    assert.equal(roleHas('viewer', 'observation.create'), false);
    assert.equal(roleHas('org_admin', 'observation.create'), false); // admin ≠ HSE authority
  });
  it('reports list scopes', () => {
    assert.deepEqual(scopesFor(corp, 'observation.view', ORG), { orgWide: true, projects: [], sites: [] });
    assert.deepEqual(scopesFor([...projEng, ...siteSup], 'observation.view', ORG), { orgWide: false, projects: [P1], sites: [{ projectId: P1, siteId: S1 }] });
    assert.equal(scopesFor(corp, 'observation.view', OTHER).orgWide, false);
  });
});

describe('observation workflow + validation', () => {
  it('exposes legal transitions per status', () => {
    assert.deepEqual(allowedTransitions('open'), ['assign', 'verify_close', 'cancel']);
    assert.deepEqual(allowedTransitions('action_submitted'), ['verify_close', 'reject_action']);
    assert.deepEqual(allowedTransitions('cancelled'), []);
  });
  it('validates observation input', () => {
    const ok = observationCreateSchema.safeParse({
      projectId: '7f1c1d7e-1f6e-4d64-9e0e-111111111111', siteId: '7f1c1d7e-1f6e-4d64-9e0e-222222222222',
      type: 'unsafe_condition', hazardCategory: 'Work at height', location: 'Level 3 slab edge',
      description: 'Missing edge protection', likelihood: 3, severity: 4, observedAt: '2026-10-20T08:15:00+04:00',
    });
    assert.equal(ok.success, true);
    const bad = observationCreateSchema.safeParse({ type: 'unsafe_condition' });
    assert.equal(bad.success, false);
  });
  it('enforces password policy', () => {
    const base = { email: 'a@b.co', fullName: 'Test User', assignments: [{ role: 'viewer' }] };
    assert.equal(userCreateSchema.safeParse({ ...base, initialPassword: 'short1' }).success, false);
    assert.equal(userCreateSchema.safeParse({ ...base, initialPassword: 'nodigitsatallhere' }).success, false);
    assert.equal(userCreateSchema.safeParse({ ...base, initialPassword: 'goodPassword123' }).success, true);
  });
});
