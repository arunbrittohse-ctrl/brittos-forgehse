import { DEFAULT_RISK_MATRIX, DEFAULT_HAZARD_CATEGORIES, validateRiskMatrix, type RiskMatrixConfig } from '@forgehse/shared';
import type { Queryable } from '../db/db';

export interface OrgSettings {
  timezone: string;
  riskMatrix: RiskMatrixConfig;
  hazardCategories: string[];
  /** Prevent the person who submitted a corrective action from verifying it. */
  segregateVerification: boolean;
  /** Longest validity of one permit to work, in hours (organisation setting; default 24). */
  permitMaxHours: number;
}

const cache = new Map<string, { at: number; value: OrgSettings }>();

export async function orgSettings(q: Queryable, organizationId: string): Promise<OrgSettings> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const raw = ((await q.query<{ settings: Record<string, unknown> }>('SELECT settings FROM organizations WHERE id = $1', [organizationId])).rows[0]?.settings ?? {}) as Partial<OrgSettings>;
  let riskMatrix = DEFAULT_RISK_MATRIX;
  if (raw.riskMatrix) {
    try { validateRiskMatrix(raw.riskMatrix); riskMatrix = raw.riskMatrix; } catch { /* invalid config falls back to default */ }
  }
  const value: OrgSettings = {
    timezone: typeof raw.timezone === 'string' ? raw.timezone : 'Asia/Dubai',
    riskMatrix,
    hazardCategories: Array.isArray(raw.hazardCategories) && raw.hazardCategories.length ? raw.hazardCategories : [...DEFAULT_HAZARD_CATEGORIES],
    segregateVerification: raw.segregateVerification !== false,
    permitMaxHours: typeof raw.permitMaxHours === 'number' && raw.permitMaxHours >= 1 && raw.permitMaxHours <= 168 ? raw.permitMaxHours : 24,
  };
  cache.set(organizationId, { at: Date.now(), value });
  return value;
}

export function clearOrgSettingsCache() { cache.clear(); }

/** Gap-free reference number allocated inside the caller's transaction (row lock on the sequence). */
export async function nextNumber(tx: Queryable, organizationId: string, scope: string, year: number): Promise<number> {
  const r = await tx.query<{ value: number }>(
    `INSERT INTO number_sequences (organization_id, scope, year, value) VALUES ($1,$2,$3,1)
     ON CONFLICT (organization_id, scope, year) DO UPDATE SET value = number_sequences.value + 1
     RETURNING value`, [organizationId, scope, year]);
  return r.rows[0]!.value;
}
